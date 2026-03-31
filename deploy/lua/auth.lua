-- Shared auth module for OpenCodeUI nginx Lua blocks
-- Verifies HTTP Basic Auth against deploy/.htpasswd

local _M = {}

function _M.verify()
    local auth_header = ngx.req.get_headers()["Authorization"]
    if not auth_header then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end

    local _, _, b64 = string.find(auth_header, "^Basic%s+(.+)$")
    if not b64 then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end

    local decoded = ngx.decode_base64(b64)
    if not decoded then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end

    -- Read credentials file, format: user:md5(user:salt:password)
    local f = io.open("/www/Opensourcepro/OpenCodeUI/deploy/.htpasswd", "r")
    if not f then
        ngx.log(ngx.ERR, "cannot open htpasswd file")
        ngx.status = 500
        ngx.say("Internal Server Error")
        ngx.exit(500)
        return
    end

    local creds = {}
    for line in f:lines() do
        local user, hash = line:match("^([^:]+):(.+)$")
        if user and hash then
            creds[user] = hash
        end
    end
    f:close()

    local user, pass = decoded:match("^([^:]+):(.+)$")
    if not user or not pass then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end

    local expected = creds[user]
    if not expected then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end

    local SALT = "opencodeui_2026"
    local computed = ngx.md5(user .. ":" .. SALT .. ":" .. pass)
    if computed ~= expected then
        ngx.header["WWW-Authenticate"] = 'Basic realm="OpenCode"'
        ngx.status = 401
        ngx.say("Unauthorized")
        ngx.exit(401)
        return
    end
end

return _M
