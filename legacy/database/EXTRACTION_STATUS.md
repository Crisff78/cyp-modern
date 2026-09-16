# Legacy backup status

**Not restored / not extracted.** The backup exists, but the project pivot explicitly discards SQL Server restoration and continues with PostgreSQL. No schemas, procedures, row counts, or relationships are presented as extracted facts.

## Source provenance

| Attribute                   | Observed value                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| Filename                    | `CobrosyPagos-GDemos-2.bak`                                        |
| Bytes                       | 7,831,040                                                          |
| SHA-256                     | `3406194142696769A0773E17FC9BB857E92D3B128054F29E7F44FCE785CAECB7` |
| Date verified               | 2026-09-16                                                         |
| Source included in Git      | No; database backups are ignored                                   |
| Restore/filelist inspection | Not run; discarded by pivot                                        |

The backup filename and byte hash establish provenance only. They do not establish the SQL Server version, logical file names, database name, encryption state, table contents, or backup validity.

## Environment checks completed

Read-only discovery checked Windows services whose names match MSSQL/SQLAgent/SQLBrowser/SQLWriter, SQL instance registry entries in both native and WOW6432Node locations, `sqlcmd.exe`/`SqlLocalDB.exe` on PATH and standard SQL tool directories, standard Program Files SQL Server directories, and the installed `SqlServer` PowerShell module list. None returned a native engine/instance/tool/module. PostgreSQL 18 native binaries are present and were used for the new scaffold verification.

## Docker activity before the prohibition

Under the earlier instruction, read-only container/image listings and an SQL Server 2022 image pull were started. On the user's correction, the outstanding pull was interrupted through its existing shell session with Ctrl+C and exited with code 1. One downloaded/extracted image layer appeared in the partial log. No SQL Server container was created, no database restore was run, and existing unrelated containers were not altered. No further Docker commands were issued.

## Pivot outcome

The restore/export workflow was removed from the delivered scaffold. `table_summary.json` intentionally uses `null` for unknown information. Do not confuse the new application's schema under `app/server/database` with extracted legacy DDL.

## Technical debt review waiting for real metadata

The following are **investigation questions, not findings**: duplicated columns or names, unreferenced tables, orphan rows without foreign keys, stored balance drift, overloading charges/payouts with loan amortization, plaintext credential storage, inconsistent decimal types, missing collector/date indexes, and business rules hidden in triggers. The mission excludes fiscal taxes and loan-interest amortization from the replacement regardless of whether such legacy objects are later found.
