---
name: code-style-guide
description: 团队编码规范。在编写或修改 TypeScript 代码时使用，确保命名、错误处理和注释风格符合团队约定。
---

# 团队编码规范

## 命名约定
- 变量和函数：camelCase（如 `getUserById`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_RETRY_COUNT`）
- 类型/接口：PascalCase（如 `UserProfile`）
- 私有成员以下划线开头（如 `_internalState`）

## 错误处理
- 不允许裸 `throw`，必须 throw 自定义错误类或 `Error` 子类
- async 函数必须 try-catch 并返回统一错误格式
- 禁止吞掉错误（空 catch 块）

## 注释风格
- 公共函数必须有 JSDoc 注释
- 注释解释"为什么"，不解释"是什么"
- TODO 注释必须带日期和负责人：`// TODO(2024-01-15, zhang): ...`

## 使用风格检查脚本
在项目根目录运行检查（脚本路径相对项目根目录，`src/` 也是项目中的目录）：
```bash
bash .pi/skills/code-style-guide/scripts/check-style.sh src/
```
脚本只粗筛 `console.log` 和未使用 `TODO(...)` 标记的 TODO，不验证括号内的日期、负责人或其他规范；风格提示不影响退出码，目录不存在或扫描失败则非零退出。若 Skill 安装在其他位置，先以本 SKILL.md 所在目录定位 `scripts/check-style.sh`，仍从项目根目录运行。
