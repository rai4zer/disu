from typing import List

def chunk_text(text: str, max_words: int, overlap_words: int) -> List[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    step = max(1, max_words - overlap_words)
    for i in range(0, len(words), step):
        chunk = words[i:i + max_words]
        if chunk:
            chunks.append(" ".join(chunk))
        if i + max_words >= len(words):
            break
    return chunks
