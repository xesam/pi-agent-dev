#!/bin/bash
# 简单的风格检查脚本
DIR="${1:-src}"
echo "扫描 $DIR ..."
grep -rn "console\.log" "$DIR" 2>/dev/null && echo "⚠️  发现 console.log"
grep -rn "TODO" "$DIR" 2>/dev/null | grep -v "TODO(" && echo "⚠️  发现未标记负责人的 TODO"
echo "检查完成。"
