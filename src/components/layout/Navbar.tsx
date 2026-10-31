import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { AnimatePresence } from 'motion/react';
import * as motion from 'motion/react-m';
import { Clock, Mail, Menu, Phone, X } from 'lucide-react';
import { NAV_LINKS } from '@/config/site';
import { useSiteContent } from '@/queries';
import { mailHref, telHref, whatsappHref } from '@/lib/format';
import { cn } from '@/lib/cn';
import { LinkButton, WhatsAppIcon } from '@/components/ui';
import { Logo } from './Logo';
import { HighlightTicker } from './HighlightTicker';

export function Navbar() {
  const content = useSiteContent();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Rotating highlights: Drone cleaning · 6 months free cleaning · PM Surya Ghar (click = smooth scroll) */}
      <HighlightTicker />

      {/* Contact bar (tablet/desktop). On phones the bottom call/WhatsApp bar does this job. */}
      <div className="hidden border-t border-navy-800 bg-navy-900 text-sm text-snow-200 md:block">
        <div className="container-site flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-1.5">
          <div className="flex items-center gap-5">
            <a
              href={telHref(content.phone)}
              className="inline-flex items-center gap-1.5 hover:text-sun-300"
            >
              <Phone className="size-3.5" aria-hidden />
              {content.phone}
            </a>
            <a
              href={mailHref(content.email)}
              className="inline-flex items-center gap-1.5 hover:text-sun-300"
            >
              <Mail className="size-3.5" aria-hidden />
              {content.email}
            </a>
            <span className="hidden items-center gap-1.5 lg:inline-flex">
              <Clock className="size-3.5" aria-hidden />
              {content.hours}
            </span>
          </div>
          {content.whatsapp && (
            <a
              href={whatsappHref(content.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-sun-300"
            >
              <WhatsAppIcon className="size-3.5" />
              Chat on WhatsApp
            </a>
          )}
        </div>
      </div>
      <header
        className={cn(
          'sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300',
          scrolled || open
            ? 'border-b border-line bg-surface/95 shadow-soft backdrop-blur-md'
            : 'border-b border-line bg-surface',
        )}
      >
        <nav
          className="container-site flex h-[4.5rem] items-center justify-between gap-4"
          aria-label="Main"
        >
          <Logo name={content.businessName} />

          <ul className="hidden items-center gap-0.5 xl:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'relative whitespace-nowrap rounded-field px-2 py-2 text-[0.92rem] font-medium transition-colors',
                      isActive
                        ? 'text-ink after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent'
                        : 'text-muted hover:text-ink',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-2 2xl:flex">
            <LinkButton to="/contact" variant="accent" size="sm">
              Get a free quote
            </LinkButton>
          </div>

          <button
            className="-mr-2 inline-flex size-11 items-center justify-center rounded-field text-ink xl:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </nav>

        <AnimatePresence>
          {open && (
            <motion.div
              id="mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-line bg-snow-100 xl:hidden"
            >
              <div className="container-site flex max-h-[calc(100dvh-7rem)] flex-col gap-1 overflow-y-auto py-4 safe-bottom">
                {NAV_LINKS.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'rounded-field px-3 py-3 text-lg font-medium',
                        isActive ? 'bg-ice-100 text-ink' : 'text-ink-soft',
                      )
                    }
                  >
                    {l.label}
                  </NavLink>
                ))}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <LinkButton
                    href={telHref(content.phone)}
                    variant="secondary"
                    leftIcon={<Phone className="size-4" />}
                  >
                    Call {content.phone}
                  </LinkButton>
                  <LinkButton to="/contact">Get a free quote</LinkButton>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
