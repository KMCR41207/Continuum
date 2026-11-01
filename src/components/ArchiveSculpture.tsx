/** Decorative source → memory → reuse model. The adjacent text carries the meaning. */
export function ArchiveSculpture() {
  return (
    <div className="archive-sculpture" aria-hidden="true">
      <div className="archive-orbit">
        <div className="archive-sheet sheet-source">
          <span>01 / SOURCE</span>
          <i />
          <i />
          <i />
          <b>“Let’s use PostgreSQL.”</b>
        </div>
        <div className="archive-sheet sheet-memory">
          <span>02 / REVIEWED</span>
          <strong>
            A decision,
            <br />
            with a history.
          </strong>
          <small>ATLAS / ARCHITECTURE</small>
        </div>
        <div className="archive-sheet sheet-context">
          <span>03 / CARRIED FORWARD</span>
          <strong>↗</strong>
          <small>YOUR CONTEXT CONTINUES</small>
        </div>
      </div>
    </div>
  );
}
