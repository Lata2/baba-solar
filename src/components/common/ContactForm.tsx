import { useRef, useState, type FormEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import * as motion from 'motion/react-m';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { EnquirySource, EnquiryType } from '@/types';
import { usePublished, useSubmitEnquiry } from '@/queries';
import { ApiError } from '@/services/errors';
import {
  CONTACT_FIELD_ORDER,
  KW_OPTIONS,
  validateContact,
  type ContactValues,
} from '@/lib/contactForm';
import {
  buildPayload,
  newSubmissionId,
  openPendingWindow,
  submitWebsiteEnquiry,
  type SubmissionResult,
} from '@/services/enquiryIntegrations';
import { Button, Input, LinkButton, Segmented, Select, Textarea, WhatsAppIcon } from '@/components/ui';

type Values = ContactValues;
type Status = 'idle' | 'submitting' | 'success' | 'error';

interface ContactFormProps {
  defaultService?: string;
  defaultMessage?: string;
  defaultCity?: string;
  defaultType?: EnquiryType;
  defaultKw?: string;
  source?: EnquirySource;
}

const TYPE_OPTIONS: Array<{ value: EnquiryType; label: string }> = [
  { value: 'home', label: 'Home' },
  { value: 'commercial', label: 'Commercial' },
];

export function ContactForm({
  defaultService = '',
  defaultMessage = '',
  defaultCity = 'Raipur',
  defaultType = 'home',
  defaultKw = '',
  source = 'contact',
}: ContactFormProps) {
  const services = usePublished('services');
  const { mutateAsync: submitEnquiry } = useSubmitEnquiry();
  const initial: Values = {
    name: '',
    phone: '',
    email: '',
    city: defaultCity,
    enquiryType: defaultType,
    kw: KW_OPTIONS.some((o) => o.value === defaultKw) ? defaultKw : '',
    service: defaultService,
    message: defaultMessage,
  };
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>(
    {},
  );
  const [status, setStatus] = useState<Status>('idle');
  const [serverError, setServerError] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  /** One id per filled-in form: re-sending after an error never creates a duplicate. */
  const submissionId = useRef<string>('');

  const serviceOptions = [
    ...services.map((s) => ({ value: s.title, label: s.title })),
    { value: 'General enquiry', label: 'Something else' },
  ];
  if (defaultService && !serviceOptions.some((o) => o.value === defaultService))
    serviceOptions.unshift({ value: defaultService, label: defaultService });

  const set = (k: keyof Values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    // Mobile and email are "one of the two": typing in either clears the shared error.
    if (errors[k] || ((k === 'email' || k === 'phone') && errors.phone))
      setErrors((er) => ({ ...er, [k]: undefined, ...(k === 'email' || k === 'phone' ? { phone: undefined } : {}) }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    const errs = validateContact(values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = CONTACT_FIELD_ORDER.find((k) => errs[k]);
      document.getElementById(`contact-${first}`)?.focus();
      return;
    }
    setStatus('submitting');
    setServerError('');
    if (!submissionId.current) submissionId.current = newSubmissionId();
    const createdAt = new Date().toISOString();
    const capacityKw = values.kw ? Number(values.kw) : null;
    const typeLabel = values.enquiryType === 'commercial' ? 'Commercial' : 'Home';
    const service = values.service.trim() || `${typeLabel} solar enquiry`;
    // Opened inside the click so browsers allow it; pointed at WhatsApp after saving.
    const pendingWindow = openPendingWindow();
    const payload = buildPayload({
      submissionId: submissionId.current,
      createdAt,
      name: values.name,
      phone: values.phone,
      email: values.email,
      enquiryType: values.enquiryType,
      capacityKw,
      message: values.message,
      city: values.city,
      service,
      source,
      page: typeof window !== 'undefined' ? window.location.href : '',
    });
    try {
      const res = await submitWebsiteEnquiry(
        payload,
        () =>
          submitEnquiry({
            name: values.name,
            phone: values.phone,
            email: values.email,
            city: values.city,
            service,
            message: values.message,
            source,
            enquiryType: values.enquiryType,
            capacityKw,
            submissionId: submissionId.current,
            createdAt,
          }),
        { pendingWindow },
      );
      setResult(res);
      if (res.delivered) {
        setStatus('success');
        submissionId.current = '';
      } else {
        setServerError(
          'We could not save your enquiry right now (your connection may be offline). It will be sent automatically when you are back online — or send it on WhatsApp now.',
        );
        setStatus('error');
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length)
        setErrors(err.fieldErrors as Partial<Record<keyof Values, string>>);
      setServerError(
        err instanceof Error ? err.message : 'Something went wrong.',
      );
      setStatus('error');
    }
  };

  const whatsappButton = result && (
    <LinkButton href={result.whatsappUrl} external leftIcon={<WhatsAppIcon className="size-4" />}>
      WhatsApp par bhejein
    </LinkButton>
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      {status === 'success' ? (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          role="status"
          className="flex flex-col items-start rounded-card border border-leaf-500/30 bg-leaf-100/60 p-8"
        >
          <CircleCheck className="size-9 text-leaf-500" aria-hidden />
          <h3 className="mt-3 text-2xl">Thank you, {values.name.trim().split(' ')[0]}</h3>
          <p className="mt-2 text-ink-soft">
            Your {values.enquiryType === 'commercial' ? 'commercial' : 'home'} solar
            enquiry{values.kw ? ` for ${values.kw} kW` : ''} is received. Our team will
            contact you soon.
          </p>
          <p className="mt-2 text-ink-soft">
            {result?.whatsapp === 'opened'
              ? 'We opened WhatsApp with your details — just tap Send for the fastest reply.'
              : 'For the fastest reply, send the same details to us on WhatsApp.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {whatsappButton}
            <Button
              variant="ghost"
              onClick={() => {
                setValues(initial);
                setResult(null);
                setStatus('idle');
              }}
            >
              Send another enquiry
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.form
          key="form"
          onSubmit={onSubmit}
          noValidate
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="grid gap-5 sm:grid-cols-2"
          aria-busy={status === 'submitting' || undefined}
        >
          <Input
            id="contact-name"
            label="Full name"
            autoComplete="name"
            required
            value={values.name}
            onChange={set('name')}
            error={errors.name}
          />
          <Input
            id="contact-phone"
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={16}
            value={values.phone}
            onChange={set('phone')}
            error={errors.phone}
            hint="Mobile or email — at least one is required."
          />
          <Input
            id="contact-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set('email')}
            error={errors.email}
          />
          <Input
            id="contact-city"
            label="City or area"
            autoComplete="address-level2"
            value={values.city}
            onChange={set('city')}
          />
          <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2">
            <Segmented
              label="What do you need?"
              className="sm:col-span-2"
              value={values.enquiryType}
              options={TYPE_OPTIONS}
              onChange={(v) => set('enquiryType')({ target: { value: v } })}
            />
            <Select
              id="contact-service"
              label="Service"
              options={serviceOptions}
              placeholder="Choose a service (optional)"
              value={values.service}
              onChange={set('service')}
              error={errors.service}
            />
            <Select
              id="contact-kw"
              label="Required kW"
              options={KW_OPTIONS}
              value={values.kw}
              onChange={set('kw')}
              error={errors.kw}
              hint="Optional — we can suggest the right size."
            />
          </div>
          <Textarea
            id="contact-message"
            label="Tell us a little more"
            required
            wrapperClassName="sm:col-span-2"
            placeholder="e.g. Monthly bill around ₹2,500, flat RCC roof of about 900 sq ft."
            value={values.message}
            onChange={set('message')}
            error={errors.message}
          />
          {status === 'error' && (
            <div
              role="alert"
              className="flex gap-3 rounded-field border border-clay-500/30 bg-clay-100/60 p-4 text-sm sm:col-span-2"
            >
              <CircleAlert
                className="size-5 shrink-0 text-clay-500"
                aria-hidden
              />
              <div>
                <p className="font-semibold text-ink">
                  Your enquiry was not sent
                </p>
                <p className="text-ink-soft">
                  {serverError} Your details are still filled in.
                </p>
                {whatsappButton && <div className="mt-3">{whatsappButton}</div>}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              We only use your details to reply to this enquiry.
            </p>
            <Button type="submit" size="lg" loading={status === 'submitting'}>
              {status === 'submitting'
                ? 'Sending…'
                : status === 'error'
                  ? 'Try sending again'
                  : 'Send enquiry'}
            </Button>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
