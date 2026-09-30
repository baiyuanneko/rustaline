# 从 Valine 导入

rustaline 的数据模型完整兼容 Valine / LeanCloud（`objectId`、`QQAvatar`（→ `qq_avatar`）、`pid`、`rid`、`insertedAt`（→ `inserted_at`）等字段全保留），历史评论可以无损迁移。`objectId` 相同的评论不会被重复导入，可放心多次操作。

## 第一步：从 LeanCloud 导出 Comment 表

登录 LeanCloud 控制台，按以下路径导出（对应管理面板「导入已保存的查询结果」的方式）：

**LeanCloud 应用 → 数据存储 → 结构化数据 → 左侧 Class 选择 `Comment` → 右侧表格右上方点击「下载查询结果」图标按钮 → 导出 JSON**

::: warning 每批最多 1000 条
「下载查询结果」每次只能导出 1000 条数据。若评论总数超出，请手动分批导出为多个文件，然后在管理面板依次上传导入。
:::

导出文件格式如下（顶层为 `{ "results": [...] }`，也接受裸数组）：

```json
{
  "results": [
    {
      "objectId": "5f8d...",
      "url": "/2020/hello-world/",
      "comment": "写得好！",
      "nick": "Anonymous",
      "mail": "",
      "link": "",
      "pid": "",
      "rid": "",
      "insertedAt": "2020-10-20T08:00:00.000Z"
    }
  ]
}
```

## 第二步：在管理面板导入

登录管理面板（`/admin/`）→「导入」页，任选一种方式：

- **上传文件**：点击选择 JSON 文件，或拖入 dropzone；支持 `.json`，可多选或一次拖入多个文件
- **粘贴 JSON**：把 JSON 内容粘贴进输入框，点击「解析粘贴内容」提交

## 导入规则

- **按 `objectId` 幂等**：已存在的评论自动跳过，重复导入不会产生重复数据
- **单批 ≤ 1000 条**：超出会被拒绝，请拆分文件分批导入
- 导入的评论 `status = approved`，导入后即公开显示；若需先审后发，导入后可在评论管理中批量处理
- 缺 `objectId` / `comment` / `url` 或字段超长的条目判为无效跳过，导入完成后会返回报告（总数 / 导入数 / 跳过重复数 / 跳过无效数及错误明细）
