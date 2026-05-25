import json

_topics_cache = None


def get_topics(exam_type: str) -> list:
    global _topics_cache
    if _topics_cache is None:
        with open("data/topics.json", "r", encoding="utf-8") as f:
            _topics_cache = json.load(f)
    return _topics_cache.get(exam_type, [])
