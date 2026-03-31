-- Sync API handler — differential sync with version tracking
-- GET  /api/sync?v=N  → {version: N, changes: {...}}
-- POST /api/sync      → {ok: true, version: N}

local sync_db = require("sync_db")
local json = require("json")

local _M = {}

-- Check if a key is blacklisted
local function is_blacklisted(key)
    if key == "oc_auth" then return true end
    if key == "opencode:notifications" then return true end
    if key:sub(1, 2) == "__" then return true end
    return false
end

-- Strip passwords from opencode-servers JSON array
local function strip_passwords(value)
    local ok, data = pcall(json.decode, value)
    if not ok or type(data) ~= "table" then return value end
    for _, server in ipairs(data) do
        if type(server) == "table" and type(server.auth) == "table" then
            server.auth.password = nil
        end
    end
    local enc_ok, encoded = pcall(json.encode, data)
    if not enc_ok then return value end
    return encoded
end

-- Merge logic for directory and project data
local function merge_value(key, incoming_value)
    local existing = sync_db.get(key)
    if not existing or not existing.value then
        return incoming_value
    end

    local ok1, existing_data = pcall(json.decode, existing.value)
    local ok2, incoming_data = pcall(json.decode, incoming_value)

    if not ok1 or not ok2 or type(existing_data) ~= "table" or type(incoming_data) ~= "table" then
        return incoming_value -- Parse failed, use LWW
    end

    if key == "opencode-saved-directories" then
        -- Union merge by path
        local merged_dirs = {}
        local seen_paths = {}
        -- Incoming takes priority (inserted first)
        for _, dir in ipairs(incoming_data.savedDirectories or {}) do
            if type(dir) == "table" and dir.path and not seen_paths[dir.path] then
                table.insert(merged_dirs, dir)
                seen_paths[dir.path] = true
            end
        end
        -- Existing entries not already seen
        for _, dir in ipairs(existing_data.savedDirectories or {}) do
            if type(dir) == "table" and dir.path and not seen_paths[dir.path] then
                table.insert(merged_dirs, dir)
                seen_paths[dir.path] = true
            end
        end
        incoming_data.savedDirectories = merged_dirs
        local enc_ok, encoded = pcall(json.encode, incoming_data)
        if not enc_ok then return incoming_value end
        return encoded
    end

    if key == "opencode-recent-projects" then
        -- Union merge by project key (incoming overwrites existing for same key)
        local merged = {}
        if type(existing_data.recentProjects) == "table" then
            for k, v in pairs(existing_data.recentProjects) do
                merged[k] = v
            end
        end
        if type(incoming_data.recentProjects) == "table" then
            for k, v in pairs(incoming_data.recentProjects) do
                merged[k] = v -- Incoming overwrites
            end
        end
        incoming_data.recentProjects = merged
        local enc_ok, encoded = pcall(json.encode, incoming_data)
        if not enc_ok then return incoming_value end
        return encoded
    end

    return incoming_value -- Default: LWW
end

-- JSON response helper
local function json_response(data, status)
    ngx.status = status or 200
    ngx.header["Content-Type"] = "application/json"
    ngx.header["Cache-Control"] = "no-store"
    ngx.say(json.encode(data))
end

-- GET handler: differential sync since version v
local function handle_get()
    local ok, init_err = sync_db.init()
    if not ok then
        json_response({error = "internal error: " .. tostring(init_err)}, 500)
        return
    end

    local since = tonumber(ngx.var.arg_v) or 0
    local data, db_err = sync_db.get_since(since)
    if not data then
        json_response({error = "internal error: " .. tostring(db_err)}, 500)
        return
    end

    json_response(data)
end

-- POST handler: apply changes
local function handle_post()
    local ok, init_err = sync_db.init()
    if not ok then
        json_response({error = "internal error: " .. tostring(init_err)}, 500)
        return
    end

    ngx.req.read_body()
    local body = ngx.req.get_body_data()

    if not body or body == "" then
        json_response({error = "request body is empty"}, 400)
        return
    end

    if #body > 262144 then
        json_response({error = "request body too large"}, 413)
        return
    end

    local decode_ok, parsed = pcall(json.decode, body)
    if not decode_ok or type(parsed) ~= "table" then
        json_response({error = "invalid JSON"}, 400)
        return
    end

    if type(parsed.changes) ~= "table" then
        json_response({error = "missing changes object"}, 400)
        return
    end

    local changes = parsed.changes

    -- FIRST: check ALL keys for blacklist before any writes
    for key, _ in pairs(changes) do
        if is_blacklisted(key) then
            json_response({error = "blacklisted key: " .. key}, 400)
            return
        end
    end

    -- SECOND: process and upsert all changes
    local latest_version = 0

    for key, value in pairs(changes) do
        local processed_value = tostring(value)

        -- Strip passwords from opencode-servers
        if key == "opencode-servers" then
            processed_value = strip_passwords(processed_value)
        end

        -- Apply merge logic for directories/projects
        if key == "opencode-saved-directories" or key == "opencode-recent-projects" then
            processed_value = merge_value(key, processed_value)
        end

        local new_version, upsert_err = sync_db.upsert(key, processed_value)
        if not new_version then
            json_response({error = "internal error: " .. tostring(upsert_err)}, 500)
            return
        end
        latest_version = new_version
    end

    -- Update shared dict for SSE notification
    if latest_version > 0 then
        local sync_dict = ngx.shared.sync_version
        if sync_dict then
            sync_dict:set("current_version", latest_version)
        end
    end

    json_response({ok = true, version = latest_version})
end

-- Main handler
function _M.handle()
    local method = ngx.var.request_method

    if method == "GET" then
        handle_get()
        return
    end

    if method == "POST" then
        handle_post()
        return
    end

    json_response({error = "method not allowed"}, 405)
end

return _M
