-- Runs once, on the first start of an empty Postgres volume.
-- The API test suite falls back to this database when Docker/Testcontainers is unavailable.
CREATE DATABASE omero_test OWNER omero;
