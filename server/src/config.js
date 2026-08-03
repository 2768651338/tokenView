require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT) || 3000
  // 数据源路径通过环境变量配置（默认取用户目录）：
  // ZCODE_DB_PATH      ZCode SQLite 路径
  // ZCODE_CONFIG_PATH  ZCode 渠道映射配置
  // CLAUDE_PROJECTS_DIR Claude Code 会话目录
};
