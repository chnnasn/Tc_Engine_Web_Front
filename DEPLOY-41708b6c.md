# 生产部署记录（2026-10-07）

## GitHub

- 前端代码：`3648094`，已推送到 `chnnasn/Tc_Engine_Web_Front` 的 main。
- 后端代码：`a801fc6`，已推送到 `chnnasn/Tc_Engine_Web_backend` 的 main。
- MCP 代码：`5ec65df`，已推送到 `chnnasn/Tc_Engine_Web_Mcp` 的 main。
- 引擎资产：[web-engine-41708b6c](https://github.com/chnnasn/Tc_Engine_Web_Front/releases/tag/web-engine-41708b6c)。Netlify 配置已指向本次压缩包。

## Railway production

项目 `TomCatEngine`（`34c40348-a0ca-4f2d-b6d4-d1b39954c678`）。

- 后端部署 `dc492aff-0565-4072-b3b3-cfd4d7e57699`：SUCCESS，实际提交 `a801fc67aff5babb8e65c2fea351cd7feea95aa4`。Linux Docker 编译及启动成功，保留原 `/data` 卷，单副本。
- Redis 服务 `58cc9871-e8cf-458a-a29a-e7e5fa906271`：新增 `redis:8.2` 服务、独立 `/data` 持久化卷、单副本，无公网 TCP 代理。
- Redis 部署 `0b3494df-c7c8-4b2c-bf51-5355f4b1776d`：SUCCESS。实际部署启动命令包含 `--appendonly yes --appendfsync everysec --maxmemory 256mb --maxmemory-policy noeviction`。日志确认创建 AOF base/incr 文件并开始接受连接。

后端配置（密码通过 Railway 引用解析，不记录实际值）：

```text
Redis__ConnectionString=${{Redis.REDISHOST}}:${{Redis.REDISPORT}},password=${{Redis.REDISPASSWORD}},abortConnect=false
Redis__KeyPrefix=tomcat:production:
Redis__FlushIntervalSeconds=30
```

首次默认 redeploy 复用了旧 Redis 启动命令；随后使用 `railway redeploy --service Redis --from-source --yes`，并核对实际部署元数据确认新命令生效。

## Netlify

- 站点：https://www.tcfun.fun
- 部署 `6ac5c39f10539ab56cee675e`，生产发布成功。
- 本地生产构建、引擎压缩完成后发布；线上 manifest 确认为 `41708b6c756d530a1c71f0e0ef2539a1df1bb03e`。
- 网站 `/health` 代理及 Railway 直接 `/health` 均返回 `status: ok`。

## 核验范围

已核对实际部署状态、Redis 启动日志、私网变量解析、单副本、卷挂载与线上健康接口；观察到的后端日志无 Redis 连接异常。未执行生产账号写入、Redis 停机或重启故障测试。

浏览器扩展未连接，未完成登录态下的生产编辑及同步接口验收。自动审批拒绝创建临时生产 SSH 密钥，未创建该密钥，未执行实例内 CONFIG GET。

本轮 Railway 项目只有后端和 Redis；MCP 仓库已推送，但本轮没有新增 Railway MCP 服务或配置模型密钥。此前的 AI 端到端通过结果属于本地验收。
