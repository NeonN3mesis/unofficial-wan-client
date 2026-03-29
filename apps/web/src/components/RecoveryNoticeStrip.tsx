interface RecoveryNotice {
  id: string;
  title: string;
  message: string;
  tone: "info" | "warning" | "error";
}

interface RecoveryNoticeStripProps {
  notices: RecoveryNotice[];
}

export function RecoveryNoticeStrip({ notices }: RecoveryNoticeStripProps) {
  return (
    <section className="recovery-notice-strip">
      {notices.map((notice) => (
        <article className={`recovery-notice is-${notice.tone}`.trim()} key={notice.id}>
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </article>
      ))}
    </section>
  );
}
