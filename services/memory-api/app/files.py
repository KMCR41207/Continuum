import hashlib
import io
import json
import zipfile
from pathlib import Path
from sqlalchemy import select
from .database import ProjectFile, FileChunk, Source, Memory, serialize
from .engine import propose, audit
from .security import authorize, deny

TEXT = {".txt", ".md", ".json", ".csv", ".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".sql", ".yaml", ".yml", ".toml", ".rs", ".go", ".java", ".c", ".cpp"}


def extract(name, content):
    suffix = Path(name).suffix.lower()
    if suffix in TEXT:
        if b"\x00" in content:
            deny("Binary content is not a text file", 422)
        try:
            result = content.decode("utf-8")
            if suffix == ".json":
                json.loads(result)
        except (UnicodeError, ValueError):
            deny("Invalid UTF-8 text or JSON", 422)
    elif suffix == ".pdf":
        if not content.startswith(b"%PDF-"):
            deny("Invalid PDF signature", 422)
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted or len(reader.pages) > 300:
            deny("Encrypted or excessive PDF", 422)
        result = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        if not zipfile.is_zipfile(io.BytesIO(content)):
            deny("Invalid DOCX", 422)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(entry.file_size for entry in archive.infolist()) > 30_000_000 or "word/document.xml" not in archive.namelist():
                deny("Invalid or excessive document archive", 422)
        from docx import Document
        result = "\n".join(p.text for p in Document(io.BytesIO(content)).paragraphs)
    else:
        deny("Unsupported file type", 422)
    if not result.strip() or len(result) > 2_000_000:
        deny("Empty or excessive extracted content", 422)
    return result


def upload(db, identity, settings, workspace, project, filename, content, media_type):
    authorize(db, identity, workspace, "files_write", project)
    if not project or not filename or Path(filename).name != filename or "/" in filename or "\\" in filename or len(filename) > 200:
        deny("Invalid filename or missing project", 422)
    if not 0 < len(content) <= settings.max_file_bytes:
        deny("File exceeds size limit", 413)
    extracted = extract(filename, content)
    key = hashlib.sha256(content).hexdigest()
    existing = db.scalar(select(ProjectFile).where(ProjectFile.workspace_id == workspace, ProjectFile.project_id == project, ProjectFile.digest == key))
    if existing:
        return serialize(existing)
    row = ProjectFile(workspace_id=workspace, project_id=project, name=filename, digest=key, size=len(content), media_type=media_type)
    db.add(row)
    db.flush()
    # Opaque generated IDs, never user-supplied names, address objects on disk.
    path = settings.data_dir / "uploads" / row.id
    with path.open("xb") as output:
        output.write(content)
    for index, start in enumerate(range(0, len(extracted), 1800)):
        chunk = extracted[start:start + 2000]
        db.add(FileChunk(workspace_id=workspace, file_id=row.id, position=index, content=chunk))
        if len(chunk.strip()) >= 12:
            memory = propose(db, workspace, project, chunk, "Facts", tags=["file"])
            db.add(Source(workspace_id=workspace, memory_id=memory.id, file_id=row.id, evidence=chunk, source_reference=filename))
    audit(db, identity, workspace, "Project file imported for review", "file", row.id)
    return serialize(row)
