-- SSE (Server-Sent Events) push notification handler for sync system
-- Polls ngx.shared.sync_version for version changes and pushes differential data

local json = require("json")
local sync_db = require("sync_db")

local _M = {}

function _M.handle()
    -- Set SSE headers before any output
    ngx.header["Content-Type"] = "text/event-stream"
    ngx.header["Cache-Control"] = "no-cache"
    ngx.header["Connection"] = "keep-alive"
    ngx.header["X-Accel-Buffering"] = "no"

    -- Ensure database is initialized (prevents 500 on first request before sync_api runs)
    -- pcall returns (ok, result1, result2, ...) so init returns (true, true) on success
    -- or (false, errmsg) on error — we need to capture both return values
    local pcall_ok, init_ok, init_err = pcall(sync_db.init)
    if not pcall_ok or not init_ok then
        ngx.log(ngx.ERR, "sync_sse: init() pcall error: ", tostring(init_err))
        ngx.sleep(0.5)
        pcall_ok, init_ok, init_err = pcall(sync_db.init)
    end
    if not pcall_ok or not init_ok then
        ngx.log(ngx.ERR, "sync_sse: init() failed after retry: ", tostring(init_err))
        ngx.status = 500
        ngx.say("event: error\ndata: {\"message\":\"db init failed\"}\n")
        ngx.flush(true)
        return
    end

    -- Get shared dict for cross-worker version notification
    local shared = ngx.shared.sync_version
    if not shared then
        ngx.log(ngx.ERR, "sync_sse: shared dict sync_version not available")
        ngx.status = 500
        ngx.say("event: error\ndata: {\"message\":\"shared dict sync_version not available\"}\n")
        ngx.flush(true)
        return
    end

    -- Send initial connected event with current version
    -- pcall returns (ok, result1, result2, ...) so get_version returns (true, version_num) on success
    -- or (true, nil, errmsg) on DB error — must check ok AND version separately
    local pcall_ok, version, ver_err = pcall(sync_db.get_version)
    if not pcall_ok or not version then
        ngx.log(ngx.ERR, "sync_sse: get_version() pcall error: ", tostring(ver_err))
        ngx.sleep(0.3)
        pcall_ok, version, ver_err = pcall(sync_db.get_version)
    end
    if not pcall_ok or not version then
        ngx.log(ngx.ERR, "sync_sse: get_version() failed after retry: ", tostring(ver_err))
        ngx.status = 500
        ngx.say("event: error\ndata: {\"message\":\"failed to get version\"}\n")
        ngx.flush(true)
        return
    end

    ngx.say("event: connected")
    ngx.say("data: " .. json.encode({ version = version }))
    ngx.say("")
    ngx.flush(true)

    local last_version = version

    -- Poll loop: check shared dict every 1 second for version changes
    while not ngx.worker.exiting() do
        local ok, res = pcall(ngx.sleep, 1)
        if not ok then
            break
        end

        -- Check if client is still connected
        if ngx.ctx and ngx.ctx.err then
            break
        end

        -- Read latest version from shared dict
        local current_version, err = shared:get("current_version")
        if current_version and type(current_version) == "number" and current_version > last_version then
            -- Version changed — fetch differential data
            local data, fetch_err = sync_db.get_since(last_version)
            if data then
                ngx.say("event: change")
                ngx.say("data: " .. json.encode({
                    version = data.version,
                    changes = data.changes
                }))
                ngx.say("")
                local flush_ok, flush_err = pcall(ngx.flush, true)
                if not flush_ok then
                    break
                end
                last_version = data.version

                -- Update shared dict to confirm this worker processed it
                shared:set("current_version", data.version)
            else
                -- Log error but continue polling
                ngx.log(ngx.ERR, "sync_sse: get_since failed: ", tostring(fetch_err))
                last_version = current_version
            end
        end
    end
end

return _M
