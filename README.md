# JWriteCoach · 日本語作文思考力トレーニング

**不只是改错，而是训练日语写作思维。**

面向中国日语学习者的 AI 写作教练 Web 应用，支持 JLPT N2 / N1 / EJU 小論文三种备考模式。

## 核心功能

| 阶段 | 功能 |
|------|------|
| 写前引导 | 题目自动匹配考试模式，引导构思立场和论据，AI 评估构思合理性 |
| 写中提问 | 苏格拉底式提问（仅提问，不直接给答案），促进独立思考 |
| 个性化批改 | 保留学生自己的立场和论点，只修正语言层面问题 |
| 写后反思 | 错误模式归纳 + 练习建议 + 同立场范文对照 |

## 技术栈

- **后端**：Python · FastAPI · SQLite
- **前端**：原生 HTML / CSS / JavaScript（无框架）
- **AI**：DeepSeek API（deepseek-v4-pro）
- **部署**：Railway

## 本地运行

```bash
# 1. 安装依赖
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY=your_key

# 3. 启动
uvicorn main:app --reload --port 8002
```

访问 http://localhost:8002

## 项目背景

个人 AI 工具项目，旨在解决「日语写作工具只批改表面错误，不训练写作思维」的痛点。
