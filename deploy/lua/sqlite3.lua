-- SQLite3 FFI wrapper for LuaJIT
-- Thin wrapper around SQLite3 C API

local ffi = require("ffi")
local sql = ffi.load("sqlite3")

ffi.cdef[[
    typedef struct sqlite3 sqlite3;
    typedef struct sqlite3_stmt sqlite3_stmt;
    typedef long long sqlite3_int64;
    int sqlite3_open(const char *filename, sqlite3 **ppDb);
    int sqlite3_close(sqlite3 *db);
    int sqlite3_close_v2(sqlite3 *db);
    int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *arg, char **errmsg);
    void sqlite3_free(void *ptr);
    int sqlite3_prepare_v2(sqlite3 *db, const char *zSql, int nByte, sqlite3_stmt **ppStmt, const char **pzTail);
    int sqlite3_step(sqlite3_stmt *stmt);
    int sqlite3_finalize(sqlite3_stmt *stmt);
    int sqlite3_reset(sqlite3_stmt *stmt);
    int sqlite3_column_count(sqlite3_stmt *stmt);
    const char *sqlite3_column_name(sqlite3_stmt *stmt, int N);
    int sqlite3_column_type(sqlite3_stmt *stmt, int iCol);
    const unsigned char *sqlite3_column_text(sqlite3_stmt *stmt, int iCol);
    int sqlite3_column_int(sqlite3_stmt *stmt, int iCol);
    sqlite3_int64 sqlite3_column_int64(sqlite3_stmt *stmt, int iCol);
    double sqlite3_column_double(sqlite3_stmt *stmt, int iCol);
    const void *sqlite3_column_blob(sqlite3_stmt *stmt, int iCol);
    int sqlite3_column_bytes(sqlite3_stmt *stmt, int iCol);
    int sqlite3_bind_null(sqlite3_stmt *stmt, int index);
    int sqlite3_bind_int(sqlite3_stmt *stmt, int index, int value);
    int sqlite3_bind_int64(sqlite3_stmt *stmt, int index, sqlite3_int64 value);
    int sqlite3_bind_double(sqlite3_stmt *stmt, int index, double value);
    int sqlite3_bind_text(sqlite3_stmt *stmt, int index, const char *value, int nByte, void *destructor);
    int sqlite3_bind_blob(sqlite3_stmt *stmt, int index, const void *value, int nByte, void *destructor);
    int sqlite3_bind_parameter_index(sqlite3_stmt *stmt, const char *zName);
    int sqlite3_changes(sqlite3 *db);
    sqlite3_int64 sqlite3_last_insert_rowid(sqlite3 *db);
    const char *sqlite3_errmsg(sqlite3 *db);
    int sqlite3_errcode(sqlite3 *db);
    const char *sqlite3_errstr(int rc);
]]

local _M = {}

-- Constants
_M.SQLITE_OK = 0
_M.SQLITE_ERROR = 1
_M.SQLITE_BUSY = 5
_M.SQLITE_ROW = 100
_M.SQLITE_DONE = 101

-- Destructor constants for bind
_M.SQLITE_STATIC = 0
_M.SQLITE_TRANSIENT = -1

-- Column type constants
_M.SQLITE_INTEGER = 1
_M.SQLITE_FLOAT = 2
_M.SQLITE_TEXT = 3
_M.SQLITE_BLOB = 4
_M.SQLITE_NULL = 5

-- Open database
-- @param path string - path to database file
-- @return db handle or nil, errmsg
function _M.open(path)
    local db = ffi.new("sqlite3*[1]")
    local cpath = ffi.cast("const char*", path)
    local rc = sql.sqlite3_open(cpath, db)
    if rc ~= _M.SQLITE_OK then
        local errmsg = ffi.string(sql.sqlite3_errmsg(db[0]))
        sql.sqlite3_close(db[0])
        return nil, errmsg
    end
    return db[0]
end

-- Close database
-- @param db - database handle
-- @return ok or nil, errmsg
function _M.close(db)
    if db == nil then
        return nil, "nil database handle"
    end
    local rc = sql.sqlite3_close(db)
    if rc ~= _M.SQLITE_OK then
        return nil, ffi.string(sql.sqlite3_errmsg(db))
    end
    return true
end

-- Execute SQL (for DDL/simple statements without results)
-- @param db - database handle
-- @param sql_str string - SQL statement
-- @return ok or nil, errmsg
function _M.exec(db, sql_str)
    if db == nil then
        return nil, "nil database handle"
    end
    local errmsg = ffi.new("char*[1]")
    local csql = ffi.cast("const char*", sql_str)
    local rc = sql.sqlite3_exec(db, csql, nil, nil, errmsg)
    if rc ~= _M.SQLITE_OK then
        local msg = errmsg[0] ~= nil and ffi.string(errmsg[0]) or "unknown error"
        if errmsg[0] ~= nil then
            sql.sqlite3_free(errmsg[0])
        end
        return nil, msg
    end
    return true
end

-- Prepare a statement
-- @param db - database handle
-- @param sql_str string - SQL statement
-- @return stmt handle or nil, errmsg
function _M.prepare(db, sql_str)
    if db == nil then
        return nil, "nil database handle"
    end
    local stmt = ffi.new("sqlite3_stmt*[1]")
    local csql = ffi.cast("const char*", sql_str)
    local rc = sql.sqlite3_prepare_v2(db, csql, -1, stmt, nil)
    if rc ~= _M.SQLITE_OK then
        return nil, ffi.string(sql.sqlite3_errmsg(db))
    end
    if stmt[0] == nil then
        return nil, "failed to prepare statement"
    end
    return stmt[0]
end

-- Step through a statement
-- @param stmt - statement handle
-- @return SQLITE_ROW, SQLITE_DONE, or error code
function _M.step(stmt)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    return sql.sqlite3_step(stmt)
end

-- Get column value as text
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return string or nil
function _M.column_text(stmt, col)
    if stmt == nil then
        return nil
    end
    local text = sql.sqlite3_column_text(stmt, col)
    if text == nil then
        return nil
    end
    return ffi.string(text)
end

-- Get column value as integer
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return number
function _M.column_int(stmt, col)
    if stmt == nil then
        return 0
    end
    return sql.sqlite3_column_int(stmt, col)
end

-- Get column value as 64-bit integer
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return number
function _M.column_int64(stmt, col)
    if stmt == nil then
        return 0
    end
    return tonumber(sql.sqlite3_column_int64(stmt, col))
end

-- Get column value as double
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return number
function _M.column_double(stmt, col)
    if stmt == nil then
        return 0.0
    end
    return sql.sqlite3_column_double(stmt, col)
end

-- Get column blob data
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return string or nil
function _M.column_blob(stmt, col)
    if stmt == nil then
        return nil
    end
    local blob = sql.sqlite3_column_blob(stmt, col)
    local bytes = sql.sqlite3_column_bytes(stmt, col)
    if blob == nil or bytes == 0 then
        return nil
    end
    return ffi.string(blob, bytes)
end

-- Get column byte count (for blob detection)
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return number
function _M.column_bytes(stmt, col)
    if stmt == nil then
        return 0
    end
    return sql.sqlite3_column_bytes(stmt, col)
end

-- Get column type
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return number (SQLITE_INTEGER, SQLITE_FLOAT, SQLITE_TEXT, SQLITE_BLOB, SQLITE_NULL)
function _M.column_type(stmt, col)
    if stmt == nil then
        return _M.SQLITE_NULL
    end
    return sql.sqlite3_column_type(stmt, col)
end

-- Get column count
-- @param stmt - statement handle
-- @return number
function _M.column_count(stmt)
    if stmt == nil then
        return 0
    end
    return sql.sqlite3_column_count(stmt)
end

-- Get column name
-- @param stmt - statement handle
-- @param col number - column index (0-based)
-- @return string or nil
function _M.column_name(stmt, col)
    if stmt == nil then
        return nil
    end
    local name = sql.sqlite3_column_name(stmt, col)
    if name == nil then
        return nil
    end
    return ffi.string(name)
end

-- Bind text to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @param text string - value to bind
-- @return rc
function _M.bind_text(stmt, idx, text)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    if text == nil then
        return sql.sqlite3_bind_null(stmt, idx)
    end
    local ctext = ffi.cast("const char*", text)
    return sql.sqlite3_bind_text(stmt, idx, ctext, #text, ffi.cast("void*", _M.SQLITE_TRANSIENT))
end

-- Bind integer to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @param val number - value to bind
-- @return rc
function _M.bind_int(stmt, idx, val)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    if val == nil then
        return sql.sqlite3_bind_null(stmt, idx)
    end
    return sql.sqlite3_bind_int(stmt, idx, val)
end

-- Bind 64-bit integer to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @param val number - value to bind
-- @return rc
function _M.bind_int64(stmt, idx, val)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    if val == nil then
        return sql.sqlite3_bind_null(stmt, idx)
    end
    return sql.sqlite3_bind_int64(stmt, idx, val)
end

-- Bind double to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @param val number - value to bind
-- @return rc
function _M.bind_double(stmt, idx, val)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    if val == nil then
        return sql.sqlite3_bind_null(stmt, idx)
    end
    return sql.sqlite3_bind_double(stmt, idx, val)
end

-- Bind null to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @return rc
function _M.bind_null(stmt, idx)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    return sql.sqlite3_bind_null(stmt, idx)
end

-- Bind blob to parameter
-- @param stmt - statement handle
-- @param idx number - parameter index (1-based)
-- @param blob string - binary data to bind
-- @return rc
function _M.bind_blob(stmt, idx, blob)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    if blob == nil then
        return sql.sqlite3_bind_null(stmt, idx)
    end
    return sql.sqlite3_bind_blob(stmt, idx, blob, #blob, ffi.cast("void*", _M.SQLITE_TRANSIENT))
end

-- Finalize statement
-- @param stmt - statement handle
-- @return rc
function _M.finalize(stmt)
    if stmt == nil then
        return _M.SQLITE_OK
    end
    return sql.sqlite3_finalize(stmt)
end

-- Reset statement for re-execution
-- @param stmt - statement handle
-- @return rc
function _M.reset(stmt)
    if stmt == nil then
        return _M.SQLITE_ERROR
    end
    return sql.sqlite3_reset(stmt)
end

-- Get number of rows changed by last statement
-- @param db - database handle
-- @return number
function _M.changes(db)
    if db == nil then
        return 0
    end
    return sql.sqlite3_changes(db)
end

-- Get last inserted rowid
-- @param db - database handle
-- @return number
function _M.last_insert_rowid(db)
    if db == nil then
        return 0
    end
    return tonumber(sql.sqlite3_last_insert_rowid(db))
end

-- Get error message
-- @param db - database handle
-- @return string
function _M.errmsg(db)
    if db == nil then
        return "nil database handle"
    end
    return ffi.string(sql.sqlite3_errmsg(db))
end

-- Get error code
-- @param db - database handle
-- @return number
function _M.errcode(db)
    if db == nil then
        return _M.SQLITE_ERROR
    end
    return sql.sqlite3_errcode(db)
end

-- Get error string for result code
-- @param rc number - result code
-- @return string
function _M.errstr(rc)
    return ffi.string(sql.sqlite3_errstr(rc))
end

return _M
