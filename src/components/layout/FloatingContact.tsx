import { Phone } from 'lucide-react';
import { useSiteContent } from '@/queries';
import { telHref, whatsappHref } from '@/lib/format';
import { WhatsAppIcon } from '@/components/ui';

/** Persistent contact actions shared by every public route and viewport. */
export function FloatingContact() {
  const content = useSiteContent();
  return (
    <aside
      aria-label="Quick contact"
      className="fixed inset-x-auto bottom-0 right-4 z-[60] flex flex-col items-end gap-3 safe-bottom sm:right-6"
    >
      <a
        href={telHref(content.phone)}
        aria-label={`Call Baba Solars at ${content.phone}`}
        className="inline-flex min-h-12 items-center gap-2 rounded-chip border border-line bg-surface px-4 py-3 font-semibold text-ink shadow-lift transition duration-200 hover:-translate-y-0.5 hover:border-steel-400 hover:bg-ice-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-400 focus-visible:ring-offset-2"
      >
        <Phone className="size-5" aria-hidden="true" />
        <span>Call Now</span>
      </a>
      {content.whatsapp ? (
        <a
          href={whatsappHref(content.whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with Baba Solars on WhatsApp"
          className="inline-flex min-h-12 items-center gap-2 rounded-chip bg-[#1f7a4d] px-4 py-3 font-semibold text-white shadow-lift transition duration-200 hover:-translate-y-0.5 hover:bg-[#17633d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2"
        >
          <WhatsAppIcon className="size-5" />
          <span>WhatsApp Chat</span>
        </a>
      ) : null}
    </aside>
  );
}
