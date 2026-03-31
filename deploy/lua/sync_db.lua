-- SQLite database operations for sync system
-- Versioned key-value store with WAL mode

local sqlite3 = require("sqlite3")
local json = require("json")

local _M = {}

-- Database configuration
local DB_PATH = "/www/Opensourcepro/OpenCodeUI/deploy/data/opencode.db"
local JSON_MIGRATION_PATH = "/www/Opensourcepro/OpenCodeUI/deploy/data/saved-directories.json"

-- SQL statements
local SQL_CREATE_SETTINGS = [[
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        server_id TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        version INTEGER NOT NULL DEFAULT 0
    )
]]

local SQL_CREATE_INDEX_SERVER = [[
    CREATE INDEX IF NOT EXISTS idx_settings_server ON settings(server_id)
]]

local SQL_CREATE_VERSION_COUNTER = [[
    CREATE TABLE IF NOT EXISTS version_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_version INTEGER NOT NULL DEFAULT 0
    )
]]

local SQL_INSERT_VERSION_COUNTER = [[
    INSERT OR IGNORE INTO version_counter (id, current_version) VALUES (1, 0)
]]

local SQL_CREATE_SSE_CLIENTS = [[
    CREATE TABLE IF NOT EXISTS sse_clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connected_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        last_version INTEGER NOT NULL DEFAULT 0
    )
]]

-- Initialize database
-- @return true or nil, errmsg
function _M.init()
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end

    -- Enable WAL mode
    local ok, err = sqlite3.exec(db, "PRAGMA journal_mode=WAL")
    if not ok then
        sqlite3.close(db)
        return nil, "failed to enable WAL mode: " .. (err or "unknown error")
    end

    -- Set busy timeout (5 seconds)
    ok, err = sqlite3.exec(db, "PRAGMA busy_timeout=5000")
    if not ok then
        sqlite3.close(db)
        return nil, "failed to set busy timeout: " .. (err or "unknown error")
    end

    -- Create tables
    local create_statements = {
        SQL_CREATE_SETTINGS,
        SQL_CREATE_INDEX_SERVER,
        SQL_CREATE_VERSION_COUNTER,
        SQL_CREATE_SSE_CLIENTS,
        SQL_INSERT_VERSION_COUNTER
    }

    for _, sql in ipairs(create_statements) do
        ok, err = sqlite3.exec(db, sql)
        if not ok then
            sqlite3.close(db)
            return nil, "failed to create table: " .. (err or "unknown error")
        end
    end

    -- Migrate JSON data if database is empty
    local stmt = sqlite3.prepare(db, "SELECT COUNT(*) FROM settings")
    if stmt then
        local rc = sqlite3.step(stmt)
        if rc == sqlite3.SQLITE_ROW then
            local count = sqlite3.column_int(stmt, 0)
            sqlite3.finalize(stmt)
            
            if count == 0 then
                -- Try to migrate from JSON
                local migrate_ok, migrate_err = _M._migrate_from_json(db)
                if not migrate_ok then
                    -- Log but don't fail - migration is optional
                    -- In production, you might want to log this
                end
            end
        else
            sqlite3.finalize(stmt)
        end
    end

    sqlite3.close(db)
    return true
end

-- Internal: Migrate data from saved-directories.json
-- @param db - database handle
-- @return true or nil, errmsg
function _M._migrate_from_json(db)
    -- Read JSON file
    local file = io.open(JSON_MIGRATION_PATH, "r")
    if not file then
        return nil, "migration file not found"
    end
    
    local content = file:read("*all")
    file:close()
    
    if not content or content == "" then
        return nil, "empty migration file"
    end
    
    -- Parse JSON
    local ok, data = pcall(json.decode, content)
    if not ok then
        return nil, "failed to parse JSON: " .. tostring(data)
    end
    
    if type(data) ~= "table" then
        return nil, "invalid JSON structure"
    end
    
    -- Migrate savedDirectories
    if data.savedDirectories and type(data.savedDirectories) == "table" then
        local dirs_json = json.encode(data.savedDirectories)
        local stmt = sqlite3.prepare(db, 
            "INSERT OR IGNORE INTO settings (key, value, server_id) VALUES ('saved-directories', ?, '')")
        if stmt then
            sqlite3.bind_text(stmt, 1, dirs_json)
            sqlite3.step(stmt)
            sqlite3.finalize(stmt)
        end
    end
    
    -- Migrate recentProjects
    if data.recentProjects and type(data.recentProjects) == "table" then
        for server_id, projects in pairs(data.recentProjects) do
            if type(projects) == "table" then
                local projects_json = json.encode(projects)
                local key = "srv:" .. server_id .. ":recent-projects"
                local stmt = sqlite3.prepare(db,
                    "INSERT OR IGNORE INTO settings (key, value, server_id) VALUES (?, ?, ?)")
                if stmt then
                    sqlite3.bind_text(stmt, 1, key)
                    sqlite3.bind_text(stmt, 2, projects_json)
                    sqlite3.bind_text(stmt, 3, server_id)
                    sqlite3.step(stmt)
                    sqlite3.finalize(stmt)
                end
            end
        end
    end
    
    return true
end

-- Get current global version number
-- @return number or nil, errmsg
function _M.get_version()
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    local stmt = sqlite3.prepare(db, "SELECT current_version FROM version_counter WHERE id = 1")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.close(db)
        return nil, "failed to prepare statement: " .. (msg or "unknown error")
    end
    
    local version = 0
    local rc = sqlite3.step(stmt)
    if rc == sqlite3.SQLITE_ROW then
        version = sqlite3.column_int(stmt, 0)
    end
    
    sqlite3.finalize(stmt)
    sqlite3.close(db)
    
    return version
end

-- Upsert a setting and return new version
-- @param key string - setting key
-- @param value string - setting value
-- @param server_id string - server identifier (optional, default '')
-- @return new_version or nil, errmsg
function _M.upsert(key, value, server_id)
    if not key then
        return nil, "key is required"
    end
    
    server_id = server_id or ""
    value = value or ""
    
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    -- Begin transaction
    local ok, err = sqlite3.exec(db, "BEGIN IMMEDIATE")
    if not ok then
        local msg = sqlite3.errmsg(db)
        sqlite3.close(db)
        return nil, "failed to begin transaction: " .. (msg or "unknown error")
    end
    
    -- Upsert the setting
    local stmt = sqlite3.prepare(db, [[
        INSERT INTO settings (key, value, server_id, updated_at) 
        VALUES (?, ?, ?, strftime('%s','now'))
        ON CONFLICT(key) DO UPDATE SET 
            value = excluded.value,
            server_id = excluded.server_id,
            updated_at = strftime('%s','now')
    ]])
    
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to prepare upsert: " .. (msg or "unknown error")
    end
    
    sqlite3.bind_text(stmt, 1, key)
    sqlite3.bind_text(stmt, 2, value)
    sqlite3.bind_text(stmt, 3, server_id)
    
    local rc = sqlite3.step(stmt)
    sqlite3.finalize(stmt)
    
    if rc ~= sqlite3.SQLITE_DONE then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "upsert failed: " .. (msg or "unknown error")
    end
    
    -- Increment version counter
    stmt = sqlite3.prepare(db, 
        "UPDATE version_counter SET current_version = current_version + 1 WHERE id = 1")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to prepare version update: " .. (msg or "unknown error")
    end
    
    rc = sqlite3.step(stmt)
    sqlite3.finalize(stmt)
    
    if rc ~= sqlite3.SQLITE_DONE then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "version update failed: " .. (msg or "unknown error")
    end
    
    -- Get new version
    stmt = sqlite3.prepare(db, "SELECT current_version FROM version_counter WHERE id = 1")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to get new version: " .. (msg or "unknown error")
    end
    
    local new_version = 0
    rc = sqlite3.step(stmt)
    if rc == sqlite3.SQLITE_ROW then
        new_version = sqlite3.column_int(stmt, 0)
    end
    sqlite3.finalize(stmt)
    
    -- Update setting's version to match
    local stmt2 = sqlite3.prepare(db, "UPDATE settings SET version = ? WHERE key = ?")
    if stmt2 then
        sqlite3.bind_int(stmt2, 1, new_version)
        sqlite3.bind_text(stmt2, 2, key)
        sqlite3.step(stmt2)
        sqlite3.finalize(stmt2)
    end
    
    -- Commit transaction
    ok, err = sqlite3.exec(db, "COMMIT")
    if not ok then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to commit: " .. (msg or "unknown error")
    end
    
    sqlite3.close(db)
    return new_version
end

-- Get all settings as a key-value map
-- @param server_id_filter string - optional filter by server_id
-- @return table or nil, errmsg
function _M.get_all(server_id_filter)
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    local sql = "SELECT key, value FROM settings"
    local stmt
    
    if server_id_filter and server_id_filter ~= "" then
        sql = sql .. " WHERE server_id = ?"
        stmt = sqlite3.prepare(db, sql)
        if stmt then
            sqlite3.bind_text(stmt, 1, server_id_filter)
        end
    else
        stmt = sqlite3.prepare(db, sql)
    end
    
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.close(db)
        return nil, "failed to prepare statement: " .. (msg or "unknown error")
    end
    
    local result = {}
    local rc = sqlite3.step(stmt)
    while rc == sqlite3.SQLITE_ROW do
        local key = sqlite3.column_text(stmt, 0)
        local value = sqlite3.column_text(stmt, 1)
        if key then
            result[key] = value or ""
        end
        rc = sqlite3.step(stmt)
    end
    
    sqlite3.finalize(stmt)
    sqlite3.close(db)
    
    return result
end

-- Get changes since a specific version
-- @param version number - starting version (exclusive)
-- @return table {version=N, changes={[key]={key,value,updated_at}}} or nil, errmsg
function _M.get_since(version)
    version = version or 0
    
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    -- Get current version
    local current_version = 0
    local stmt = sqlite3.prepare(db, "SELECT current_version FROM version_counter WHERE id = 1")
    if stmt then
        local rc = sqlite3.step(stmt)
        if rc == sqlite3.SQLITE_ROW then
            current_version = sqlite3.column_int(stmt, 0)
        end
        sqlite3.finalize(stmt)
    end
    
    -- Get changed settings
    stmt = sqlite3.prepare(db, 
        "SELECT key, value, updated_at, version FROM settings WHERE version > ?")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.close(db)
        return nil, "failed to prepare statement: " .. (msg or "unknown error")
    end
    
    sqlite3.bind_int(stmt, 1, version)
    
    local changes = {}
    local rc = sqlite3.step(stmt)
    while rc == sqlite3.SQLITE_ROW do
        local key = sqlite3.column_text(stmt, 0)
        local value = sqlite3.column_text(stmt, 1)
        local updated_at = sqlite3.column_int(stmt, 2)
        local ver = sqlite3.column_int(stmt, 3)
        
        if key then
            changes[key] = {
                key = key,
                value = value or "",
                updated_at = updated_at,
                version = ver
            }
        end
        rc = sqlite3.step(stmt)
    end
    
    sqlite3.finalize(stmt)
    sqlite3.close(db)
    
    return {
        version = current_version,
        changes = changes
    }
end

-- Get a single setting by key
-- @param key string - setting key
-- @return table {key, value, updated_at, version} or nil
function _M.get(key)
    if not key then
        return nil
    end
    
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    local stmt = sqlite3.prepare(db, 
        "SELECT key, value, updated_at, version FROM settings WHERE key = ?")
    if not stmt then
        sqlite3.close(db)
        return nil
    end
    
    sqlite3.bind_text(stmt, 1, key)
    
    local result = nil
    local rc = sqlite3.step(stmt)
    if rc == sqlite3.SQLITE_ROW then
        result = {
            key = sqlite3.column_text(stmt, 0),
            value = sqlite3.column_text(stmt, 1) or "",
            updated_at = sqlite3.column_int(stmt, 2),
            version = sqlite3.column_int(stmt, 3)
        }
    end
    
    sqlite3.finalize(stmt)
    sqlite3.close(db)
    
    return result
end

-- Delete a setting
-- @param key string - setting key
-- @return new_version or nil, errmsg
function _M.delete(key)
    if not key then
        return nil, "key is required"
    end
    
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return nil, "failed to open database: " .. (err or "unknown error")
    end
    
    -- Begin transaction
    local ok, err = sqlite3.exec(db, "BEGIN IMMEDIATE")
    if not ok then
        local msg = sqlite3.errmsg(db)
        sqlite3.close(db)
        return nil, "failed to begin transaction: " .. (msg or "unknown error")
    end
    
    -- Delete the setting
    local stmt = sqlite3.prepare(db, "DELETE FROM settings WHERE key = ?")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to prepare delete: " .. (msg or "unknown error")
    end
    
    sqlite3.bind_text(stmt, 1, key)
    local rc = sqlite3.step(stmt)
    sqlite3.finalize(stmt)
    
    if rc ~= sqlite3.SQLITE_DONE then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "delete failed: " .. (msg or "unknown error")
    end
    
    -- Check if anything was deleted
    local changes = sqlite3.changes(db)
    if changes == 0 then
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "key not found"
    end
    
    -- Increment version counter
    stmt = sqlite3.prepare(db, 
        "UPDATE version_counter SET current_version = current_version + 1 WHERE id = 1")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to prepare version update: " .. (msg or "unknown error")
    end
    
    rc = sqlite3.step(stmt)
    sqlite3.finalize(stmt)
    
    if rc ~= sqlite3.SQLITE_DONE then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "version update failed: " .. (msg or "unknown error")
    end
    
    -- Get new version
    stmt = sqlite3.prepare(db, "SELECT current_version FROM version_counter WHERE id = 1")
    if not stmt then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to get new version: " .. (msg or "unknown error")
    end
    
    local new_version = 0
    rc = sqlite3.step(stmt)
    if rc == sqlite3.SQLITE_ROW then
        new_version = sqlite3.column_int(stmt, 0)
    end
    sqlite3.finalize(stmt)
    
    -- Commit transaction
    ok, err = sqlite3.exec(db, "COMMIT")
    if not ok then
        local msg = sqlite3.errmsg(db)
        sqlite3.exec(db, "ROLLBACK")
        sqlite3.close(db)
        return nil, "failed to commit: " .. (msg or "unknown error")
    end
    
    sqlite3.close(db)
    return new_version
end

-- Get database statistics
-- @return table {total_settings, db_size_bytes, wal_size_bytes}
function _M.get_stats()
    local result = {
        total_settings = 0,
        db_size_bytes = 0,
        wal_size_bytes = 0
    }
    
    local db, err = sqlite3.open(DB_PATH)
    if not db then
        return result
    end
    
    -- Get total settings count
    local stmt = sqlite3.prepare(db, "SELECT COUNT(*) FROM settings")
    if stmt then
        local rc = sqlite3.step(stmt)
        if rc == sqlite3.SQLITE_ROW then
            result.total_settings = sqlite3.column_int(stmt, 0)
        end
        sqlite3.finalize(stmt)
    end
    
    sqlite3.close(db)
    
    -- Get file sizes
    local db_file = io.open(DB_PATH, "rb")
    if db_file then
        local size = db_file:seek("end")
        result.db_size_bytes = size or 0
        db_file:close()
    end
    
    local wal_file = io.open(DB_PATH .. "-wal", "rb")
    if wal_file then
        local size = wal_file:seek("end")
        result.wal_size_bytes = size or 0
        wal_file:close()
    end
    
    return result
end

return _M
