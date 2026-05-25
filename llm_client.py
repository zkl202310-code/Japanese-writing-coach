import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com",
        )
    return _client


def chat(system: str, user: str, temperature: float = 0.7) -> str:
    client = get_client()
    response = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
    )
    return response.choices[0].message.content


def chat_json(system: str, user: str) -> str:
    client = get_client()
    response = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content
