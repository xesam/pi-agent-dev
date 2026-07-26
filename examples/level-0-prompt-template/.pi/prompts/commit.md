---
description: 按 Conventional Commits 格式生成 commit message
---
看一下 `git diff --cached` 的改动，生成一条符合 Conventional Commits 规范的 commit message。

格式要求：
- 类型前缀：feat / fix / docs / refactor / test / chore
- 简短描述不超过 50 字符
- 如果改动较大，空一行后写正文说明

只输出 commit message 本身，不要加多余的格式化标记。
