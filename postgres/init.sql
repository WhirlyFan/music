-- Initial Postgres setup for the react-django-template project.
-- Runs on first container start (when postgres_data volume is empty).
--
-- Creates two roles:
--   app_user  — runtime role for Django + workers. NO BYPASSRLS.
--               RLS policies enforce isolation; this role cannot escape them.
--   app_admin — used for migrations, seed, and management commands that
--               legitimately need to operate across owners (with BYPASSRLS).
--
-- And two databases:
--   appdb     — Django app data
--   hatchetdb — Hatchet Lite workflow engine state

-- ---- Roles ----------------------------------------------------------------

CREATE ROLE app_admin
    WITH LOGIN PASSWORD 'app_admin' BYPASSRLS CREATEDB;

CREATE ROLE app_user
    WITH LOGIN PASSWORD 'app_user';
-- Deliberately NO BYPASSRLS. NO SUPERUSER. NO CREATEDB.

-- Let app_admin assume the app_user role via SET ROLE — useful in tests where
-- pytest connects as admin (to set up data across owners) and then switches
-- to app_user (to verify that RLS policies block leakage).
GRANT app_user TO app_admin;

-- ---- Databases ------------------------------------------------------------

CREATE DATABASE appdb     OWNER app_admin;
CREATE DATABASE hatchetdb OWNER app_admin;

-- ---- Privileges -----------------------------------------------------------

-- app_user gets full DML on the app database, but RLS policies (added by
-- django-rls migrations) filter what it can actually see.
\connect appdb

GRANT CONNECT ON DATABASE appdb TO app_user;
GRANT USAGE  ON SCHEMA public TO app_user;
GRANT ALL    ON SCHEMA public TO app_admin;

-- Ensure future tables/sequences created by django-admin (running as
-- app_admin) are usable by app_user.
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- hatchetdb is fully owned by app_admin; Hatchet manages its own schema.
\connect hatchetdb
GRANT ALL ON SCHEMA public TO app_admin;
