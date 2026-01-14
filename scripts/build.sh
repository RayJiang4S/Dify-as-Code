#!/bin/bash

# Dify as Code - 打包脚本
# 用法: ./scripts/build.sh [--patch|--minor|--major]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录，然后切换到项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}       Dify as Code - 打包脚本${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 读取当前版本
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}当前版本: ${NC}${CURRENT_VERSION}"

# 处理版本更新参数
VERSION_BUMP=""
if [ "$1" == "--patch" ]; then
    VERSION_BUMP="patch"
elif [ "$1" == "--minor" ]; then
    VERSION_BUMP="minor"
elif [ "$1" == "--major" ]; then
    VERSION_BUMP="major"
fi

if [ -n "$VERSION_BUMP" ]; then
    echo -e "${YELLOW}版本升级: ${NC}${VERSION_BUMP}"
    npm version $VERSION_BUMP --no-git-tag-version
    CURRENT_VERSION=$(node -p "require('./package.json').version")
    echo -e "${GREEN}新版本: ${NC}${CURRENT_VERSION}"
fi

echo ""

# 步骤 1: 检查依赖
echo -e "${BLUE}[1/5]${NC} 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}      安装依赖...${NC}"
    npm install
fi

# 步骤 2: 清理旧的编译文件
echo -e "${BLUE}[2/5]${NC} 清理旧文件..."
rm -rf out
rm -f dify-as-code-*.vsix

# 步骤 3: 使用 esbuild 打包
echo -e "${BLUE}[3/5]${NC} 编译代码 (esbuild)..."
node esbuild.js --production

# 步骤 4: 生成 vsix
echo -e "${BLUE}[4/5]${NC} 打包 VSIX..."
npx vsce package --no-dependencies

# 步骤 5: 显示结果
VSIX_FILE="dify-as-code-${CURRENT_VERSION}.vsix"
if [ -f "$VSIX_FILE" ]; then
    VSIX_SIZE=$(ls -lh "$VSIX_FILE" | awk '{print $5}')
    echo -e "${BLUE}[5/5]${NC} 验证打包结果..."
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ✅ 打包成功!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  文件: ${BLUE}${VSIX_FILE}${NC}"
    echo -e "  大小: ${BLUE}${VSIX_SIZE}${NC}"
    echo ""
    echo -e "  ${YELLOW}安装方法:${NC}"
    echo -e "  1. 在 VS Code/Cursor 中按 Cmd+Shift+P"
    echo -e "  2. 输入 'Install from VSIX'"
    echo -e "  3. 选择 ${VSIX_FILE}"
    echo ""
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  ❌ 打包失败!${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
