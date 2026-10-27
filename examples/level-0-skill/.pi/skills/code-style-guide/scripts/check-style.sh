#!/bin/bash
# 粗筛常见标记；不验证 TODO(...) 内的日期和负责人，也不作为提交门禁。
SCAN_DIR="${1:-src}"
if [[ ! -d "$SCAN_DIR" || ! -r "$SCAN_DIR" ]]; then
  echo "无法扫描目录：$SCAN_DIR" >&2
  exit 2
fi

scan_pattern() {
  local matches status
  if matches=$(grep -rnE -- "$1" "$SCAN_DIR"); then
    printf '%s\n' "$matches"
    echo "$2"
  else
    status=$?
    # grep 的 1 表示无匹配，其他非零状态表示扫描失败。
    if [[ "$status" -ne 1 ]]; then
      echo "扫描失败：$SCAN_DIR" >&2
      exit "$status"
    fi
  fi
}

echo "扫描 $SCAN_DIR ..."
scan_pattern 'console\.log' '⚠️  发现 console.log'
scan_pattern 'TODO([^(]|$)' '⚠️  发现未使用 TODO(...) 标记的 TODO'
echo "检查完成（风格提示不影响退出码）。"
