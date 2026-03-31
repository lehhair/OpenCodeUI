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

    -- Get shared dict for cross-worker version notification
    local shared = ngx.shared.sync_version
    if not shared then
        ngx.status = 500
        ngx.say("event: error\ndata: {\"message\":\"shared dict sync_version not available\"}\n")
        ngx.flush(true)
        return
    end

    -- Send initial connected event with current version
    local version, err = sync_db.get_version()
    if not version then
        ngx.status = 500
        ngx.say("event: error\ndata: {\"message\":\"failed to get version: " .. tostring(err) .. "\"}\n")
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
