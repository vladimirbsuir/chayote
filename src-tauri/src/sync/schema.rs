use tokio_postgres::Client;

use crate::error::AppError;

use super::{network, pg_error, query_timeout, QUERY_TIMEOUT};

const MIGRATION_LOCK: i64 = 0x0043_4841_594f_5445;

pub(super) struct ServerMigration {
    pub name: &'static str,
    pub sql: &'static str,
}

pub(super) const SERVER_MIGRATIONS: &[ServerMigration] = &[ServerMigration {
    name: "0001_initial.sql",
    sql: include_str!("../../../postgres/migrations/0001_initial.sql"),
}];

pub(super) fn latest_version() -> i32 {
    SERVER_MIGRATIONS.len() as i32
}

pub(super) async fn ensure_server_schema(client: &mut Client) -> Result<(), AppError> {
    let current = server_version(client).await?;
    check_not_ahead(current)?;
    if current == latest_version() {
        return Ok(());
    }
    tokio::time::timeout(QUERY_TIMEOUT * 4, migrate(client))
        .await
        .map_err(|_| network(query_timeout()))?
        .map_err(|err| match err {
            MigrateError::App(app) => app,
            MigrateError::Pg(pg) => schema_write_error(pg),
        })
}

async fn server_version(client: &Client) -> Result<i32, AppError> {
    let read = tokio::time::timeout(
        QUERY_TIMEOUT,
        client.query_one(
            "SELECT COALESCE(max(version), 0) FROM chayote_schema_migrations",
            &[],
        ),
    )
    .await
    .map_err(|_| network(query_timeout()))?;
    match read {
        Ok(row) => row.try_get(0).map_err(network),
        Err(err) if is_undefined_table(&err) => Ok(0),
        Err(err) => Err(pg_error(err)),
    }
}

fn is_undefined_table(err: &tokio_postgres::Error) -> bool {
    err.as_db_error()
        .is_some_and(|db| db.code().code() == "42P01")
}

fn check_not_ahead(current: i32) -> Result<(), AppError> {
    let known = latest_version();
    if current > known {
        return Err(AppError::Validation(format!(
            "The sync server was upgraded by a newer Chayote (server schema {current}, this app knows {known}) — update Chayote on this device to keep syncing."
        )));
    }
    Ok(())
}

enum MigrateError {
    App(AppError),
    Pg(tokio_postgres::Error),
}

impl From<tokio_postgres::Error> for MigrateError {
    fn from(err: tokio_postgres::Error) -> Self {
        Self::Pg(err)
    }
}

async fn migrate(client: &mut Client) -> Result<(), MigrateError> {
    let tx = client.transaction().await?;
    tx.execute("SELECT pg_advisory_xact_lock($1)", &[&MIGRATION_LOCK])
        .await?;
    tx.batch_execute(
        "CREATE TABLE IF NOT EXISTS chayote_schema_migrations (
           version    INTEGER PRIMARY KEY,
           name       TEXT    NOT NULL,
           applied_at BIGINT  NOT NULL
         )",
    )
    .await?;
    let current: i32 = tx
        .query_one(
            "SELECT COALESCE(max(version), 0) FROM chayote_schema_migrations",
            &[],
        )
        .await?
        .get(0);
    check_not_ahead(current).map_err(MigrateError::App)?;
    for (index, step) in SERVER_MIGRATIONS.iter().enumerate() {
        let version = index as i32 + 1;
        if version <= current {
            continue;
        }
        tx.batch_execute(step.sql).await?;
        tx.execute(
            "INSERT INTO chayote_schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)",
            &[&version, &step.name, &crate::clock::now_ms()],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

fn schema_write_error(err: tokio_postgres::Error) -> AppError {
    let denied = err
        .as_db_error()
        .is_some_and(|db| db.code().code() == "42501");
    if denied {
        AppError::Validation(format!(
            "The sync server would not let this connection create Chayote's tables — use a role that may create tables, or run postgres/migrations by hand ({err})."
        ))
    } else {
        pg_error(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_dense_and_named_in_order() {
        for (index, step) in SERVER_MIGRATIONS.iter().enumerate() {
            let prefix = format!("{:04}_", index + 1);
            assert!(
                step.name.starts_with(&prefix),
                "{} should start with {prefix}",
                step.name
            );
        }
        assert_eq!(latest_version() as usize, SERVER_MIGRATIONS.len());
    }

    #[test]
    fn every_migration_file_is_listed() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../postgres/migrations");
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .expect("migrations folder reads")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.ends_with(".sql"))
            .collect();
        files.sort();
        let listed: Vec<&str> = SERVER_MIGRATIONS.iter().map(|step| step.name).collect();
        assert_eq!(files, listed);
    }

    #[test]
    fn a_server_ahead_of_the_app_is_refused() {
        assert!(check_not_ahead(latest_version()).is_ok());
        let err = check_not_ahead(latest_version() + 1).expect_err("refused");
        assert_eq!(err.code(), "VALIDATION");
    }
    async fn live_client() -> Option<Client> {
        let Ok(url) = std::env::var("CHAYOTE_SYNC_2DEV_URL") else {
            eprintln!("skipping live schema test: CHAYOTE_SYNC_2DEV_URL unset");
            return None;
        };
        Some(
            super::super::connect(&url)
                .await
                .expect("connects to test Postgres"),
        )
    }

    async fn wipe_server(client: &Client) {
        client
            .batch_execute(
                "DROP TABLE IF EXISTS note_tags, notes, tags, folders, chayote_schema_migrations CASCADE;
                 DROP SEQUENCE IF EXISTS sync_rev_seq;",
            )
            .await
            .expect("server wipes");
    }

    async fn recorded_versions(client: &Client) -> Vec<i32> {
        client
            .query(
                "SELECT version FROM chayote_schema_migrations ORDER BY version",
                &[],
            )
            .await
            .expect("versions read")
            .iter()
            .map(|row| row.get(0))
            .collect()
    }

    fn all_versions() -> Vec<i32> {
        (1..=latest_version()).collect()
    }

    #[tokio::test]
    async fn live_first_sync_creates_the_schema_on_an_empty_server() {
        let _turn = super::super::tests::LIVE_2DEV.lock().await;
        let Some(client) = live_client().await else {
            return;
        };
        wipe_server(&client).await;

        let url = std::env::var("CHAYOTE_SYNC_2DEV_URL").expect("checked above");
        let dir = std::env::temp_dir().join(format!("chayote-schema-live-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = std::sync::Arc::new(crate::db::Database::open(&dir).expect("database opens"));
        let sync = super::super::SyncService::new(std::sync::Arc::clone(&db));
        let tags = crate::repo::tags::SqliteTagsRepo::new(std::sync::Arc::clone(&db));
        crate::repo::TagsRepo::create(&tags, "FirstSync").expect("tag creates");
        sync.set_config(&url, true).expect("config saves");

        let first = sync
            .run_cycle(None)
            .await
            .expect("first cycle on an empty server");
        assert_eq!(first.pushed, 1);
        assert_eq!(recorded_versions(&client).await, all_versions());
        let names: Vec<String> = client
            .query("SELECT name FROM tags", &[])
            .await
            .expect("tags read")
            .iter()
            .map(|row| row.get(0))
            .collect();
        assert_eq!(names, vec!["FirstSync".to_string()]);

        sync.run_cycle(None).await.expect("second cycle");
        assert_eq!(recorded_versions(&client).await, all_versions());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn live_two_devices_migrating_at_once_apply_each_step_once() {
        let _turn = super::super::tests::LIVE_2DEV.lock().await;
        let Some(client) = live_client().await else {
            return;
        };
        wipe_server(&client).await;
        let mut a = live_client().await.expect("second connection");
        let mut b = live_client().await.expect("third connection");

        let (left, right) =
            tokio::join!(ensure_server_schema(&mut a), ensure_server_schema(&mut b));
        left.expect("device A migrates");
        right.expect("device B migrates");
        assert_eq!(recorded_versions(&client).await, all_versions());
    }

    #[tokio::test]
    async fn live_a_hand_applied_server_is_adopted_without_change() {
        let _turn = super::super::tests::LIVE_2DEV.lock().await;
        let Some(mut client) = live_client().await else {
            return;
        };
        wipe_server(&client).await;
        client
            .batch_execute(SERVER_MIGRATIONS[0].sql)
            .await
            .expect("hand-applied schema");
        client
            .execute(
                "INSERT INTO tags (id, name, created_at, updated_at) VALUES (gen_random_uuid(), 'Kept', 1, 1)",
                &[],
            )
            .await
            .expect("existing row");

        ensure_server_schema(&mut client)
            .await
            .expect("adopts the server");
        assert_eq!(recorded_versions(&client).await, all_versions());
        let kept: i64 = client
            .query_one("SELECT count(*) FROM tags WHERE name = 'Kept'", &[])
            .await
            .expect("count")
            .get(0);
        assert_eq!(kept, 1);
    }

    #[tokio::test]
    async fn live_a_server_ahead_of_the_app_stops_sync_with_a_reason() {
        let _turn = super::super::tests::LIVE_2DEV.lock().await;
        let Some(mut client) = live_client().await else {
            return;
        };
        wipe_server(&client).await;
        ensure_server_schema(&mut client).await.expect("migrates");
        client
            .execute(
                "INSERT INTO chayote_schema_migrations (version, name, applied_at) VALUES ($1, 'future.sql', 1)",
                &[&(latest_version() + 1)],
            )
            .await
            .expect("future version");

        let err = ensure_server_schema(&mut client)
            .await
            .expect_err("refused");
        assert_eq!(err.code(), "VALIDATION");
        assert!(
            err.log_line().contains("update Chayote"),
            "{}",
            err.log_line()
        );
        wipe_server(&client).await;
    }
}
