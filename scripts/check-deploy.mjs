import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const account = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
if (!account || !/^[a-f0-9]{32}$/i.test(account))
  throw new Error(
    "请先确认 Topfast 所属账号，并设置 CLOUDFLARE_ACCOUNT_ID 或 wrangler.jsonc 的 account_id。",
  );
if (!/^[a-f0-9-]{36}$/i.test(config.d1_databases[0].database_id))
  throw new Error("请先创建/选择工单 D1 数据库，并填写真实 database_id。");
console.log(
  `Deploy target: ${config.name}; account: ${account}; database: ${config.d1_databases[0].database_name}`,
);
