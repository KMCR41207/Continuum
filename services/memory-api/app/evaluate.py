"""Opt-in local model relevance evaluation; no user data or remote model calls."""
import json
from pathlib import Path
from .config import Settings
from .embeddings import Embeddings, Vectors
from .database import Memory


def evaluate(settings, dataset=None):
    dataset = dataset or json.loads((Path(__file__).parents[1] / "tests" / "retrieval-evaluation.json").read_text())
    import tempfile
    # Windows Chroma holds an index handle until process exit; use an isolated retained temp directory.
    directory = tempfile.mkdtemp(prefix="continuum-model-evaluation-")
    if directory:
        local = settings.model_copy(update={"data_dir": Path(directory)})
        local.prepare()
        embeddings = Embeddings(local)
        vectors = Vectors(local, embeddings)
        for index, item in enumerate(dataset):
            vectors.put(Memory(id=f"evaluation-{index}", workspace_id="evaluation", project_id="project", content=item["memory"], version=1))
        results = []
        for index, item in enumerate(dataset):
            ranked = vectors.search("evaluation", "project", item["query"], count=len(dataset))
            ids = sorted(ranked, key=lambda identifier: ranked[identifier][0], reverse=True)
            rank = ids.index(f"evaluation-{index}") + 1
            results.append({"query": item["query"], "expected_rank": rank})
        return {"model": embeddings.model_name(), "dimensions": embeddings.dimensions(), "queries": len(results), "recall_at_1": sum(r["expected_rank"] == 1 for r in results) / len(results), "mean_reciprocal_rank": sum(1 / r["expected_rank"] for r in results) / len(results), "results": results}


if __name__ == "__main__":
    print(json.dumps(evaluate(Settings().prepare()), indent=2))
