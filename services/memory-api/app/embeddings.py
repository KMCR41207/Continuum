import hashlib
import math
from urllib.parse import urlparse
import httpx


def local_url(url, allow_remote):
    parsed = urlparse(url)
    if parsed.username or parsed.password or parsed.scheme not in ("http", "https"):
        raise ValueError("Invalid model endpoint")
    if parsed.hostname not in ("127.0.0.1", "localhost", "::1", "ollama"):
        if not allow_remote or parsed.scheme != "https":
            raise ValueError("Remote processing requires explicit opt-in and HTTPS")


class Embeddings:
    def __init__(self, settings):
        self.settings = settings
        self.model = None
        self.dimension = None

    def model_name(self):
        return self.settings.embedding_provider + ":" + self.settings.embedding_model

    def dimensions(self):
        if self.dimension is None:
            self.embed_text("dimension probe")
        return self.dimension

    def embed_text(self, text):
        return self.embed_documents([text])[0]

    def embed_documents(self, documents):
        s = self.settings
        if s.embedding_provider == "sentence-transformers":
            from sentence_transformers import SentenceTransformer
            if self.model is None:
                self.model = SentenceTransformer(s.embedding_model, local_files_only=s.model_local_only, trust_remote_code=False)
            values = self.model.encode(documents, normalize_embeddings=True).tolist()
        elif s.embedding_provider in ("ollama", "remote"):
            local_url(s.embedding_url, s.allow_remote_processing)
            response = httpx.post(s.embedding_url, json={"model": s.embedding_model, "input": documents}, headers={"Authorization": f"Bearer {s.embedding_key}"} if s.embedding_key else {}, timeout=60, follow_redirects=False)
            response.raise_for_status()
            data = response.json()
            values = data.get("embeddings") if s.embedding_provider == "ollama" else [row["embedding"] for row in data["data"]]
        else:
            raise ValueError("No embedding provider configured")
        if len(values) != len(documents) or not values or not values[0]:
            raise ValueError("Invalid embedding response")
        size = len(values[0])
        if self.dimension and self.dimension != size:
            raise ValueError("Embedding dimensions changed; reindex required")
        if any(len(v) != size or any(not isinstance(x, (float, int)) or not math.isfinite(x) for x in v) or not any(v) for v in values):
            raise ValueError("Invalid embedding values")
        self.dimension = size
        return values

    def health_check(self):
        try:
            self.embed_text("health check")
            return True
        except Exception:
            return False


class Vectors:
    def __init__(self, settings, embeddings):
        import chromadb
        from chromadb.config import Settings
        if settings.chroma_url:
            parsed = urlparse(settings.chroma_url)
            if parsed.hostname not in ("chroma", "127.0.0.1", "localhost"):
                raise ValueError("Use a private local Chroma endpoint")
            self.client = chromadb.HttpClient(host=parsed.hostname, port=parsed.port or 8000, settings=Settings(anonymized_telemetry=False))
        else:
            self.client = chromadb.PersistentClient(path=str(settings.data_dir / "chroma"), settings=Settings(anonymized_telemetry=False))
        self.embeddings = embeddings

    def collection(self):
        key = f"{self.embeddings.model_name()}:{self.embeddings.dimensions()}"
        return self.client.get_or_create_collection("memories_" + hashlib.sha256(key.encode()).hexdigest()[:24], metadata={"model": self.embeddings.model_name(), "dimensions": self.embeddings.dimensions(), "hnsw:space": "cosine"}, embedding_function=None)

    def put(self, memory):
        vector = self.embeddings.embed_text(memory.content)
        self.collection().upsert(ids=[memory.id], embeddings=[vector], metadatas=[{"workspace_id": memory.workspace_id, "project_id": memory.project_id or "global", "version": memory.version}], documents=[memory.content])

    def search(self, workspace, project, text, count=50):
        vector = self.embeddings.embed_text(text)
        where = {"$and": [{"workspace_id": workspace}, {"project_id": project}]} if project else {"workspace_id": workspace}
        result = self.collection().query(query_embeddings=[vector], where=where, n_results=count)
        return {i: (max(0, 1 - distance), meta["version"]) for i, distance, meta in zip(result["ids"][0], result["distances"][0], result["metadatas"][0])}

    def delete(self, ids):
        for collection in self.client.list_collections():
            self.client.get_collection(collection.name, embedding_function=None).delete(ids=ids)

    def health(self):
        self.client.heartbeat()
        return True
