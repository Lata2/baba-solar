import { useState, type FormEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import * as motion from 'motion/react-m';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { EnquirySource } from '@/types';
import { usePublished, useSiteContent, useSubmitEnquiry } from '@/queries';
import {
  indianPhone,
  minLength,
  optionalEmail,
  required,
  validate,
} from '@/lib/validation';
import { whatsappHref } from '@/lib/format';
import { Button, Input, LinkButton, Select, Textarea } from '@/components/ui';

type Values = {
  name: string;
  phone: string;
  email: string;
  city: string;
  service: string;
  message: string;
};
type Status = 'idle' | 'submitting' | 'success' | 'error';

interface ContactFormProps {
  defaultService?: string;
  defaultMessage?: string;
  defaultCity?: string;
  source?: EnquirySource;
}

export function ContactForm({
  defaultService = '',
  defaultMessage = '',
  defaultCity = 'Raipur',
  source = 'contact',
}: ContactFormProps) {
  const services = usePublished('services');
  const content = useSiteContent();
  const { mutateAsync: submitEnquiry } = useSubmitEnquiry();
  const initial: Values = {
    name: '',
    phone: '',
    email: '',
    city: defaultCity,
    service: defaultService,
    message: defaultMessage,
  };
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>(
    {},
  );
  const [status, setStatus] = useState<Status>('idle');
  const [serverError, setServerError] = useState('');

  const serviceOptions = [
    ...services.map((s) => ({ value: s.title, label: s.title })),
    { value: 'General enquiry', label: 'Something else' },
  ];
  if (defaultService && !serviceOptions.some((o) => o.value === defaultService))
    serviceOptions.unshift({ value: defaultService, label: defaultService });

  const set = (k: keyof Values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validate(values, {
      name: [required('your name'), minLength(2, 'Name')],
      phone: [indianPhone],
      email: [optionalEmail],
      service: [required('what you need help with')],
      message: [minLength(10, 'Message')],
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`contact-${first}`)?.focus();
      return;
    }
    setStatus('submitting');
    setServerError('');
    try {
      await submitEnquiry({ ...values, source });
      setStatus('success');
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Something went wrong.',
      );
      setStatus('error');
    }
  };

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
          <h3 className="mt-3 text-2xl">Enquiry received</h3>
          <p className="mt-2 text-ink-soft">
            Thanks, {values.name.split(' ')[0]}. We will call you on{' '}
            {values.phone} within one working day. For anything urgent, message
            us on WhatsApp.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {content.whatsapp && (
              <LinkButton
                href={whatsappHref(
                  content.whatsapp,
                  `Hi, I just sent an enquiry about ${values.service}. My name is ${values.name}.`,
                )}
                external
                variant="secondary"
              >
                Message on WhatsApp
              </LinkButton>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setValues(initial);
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
            required
            value={values.phone}
            onChange={set('phone')}
            error={errors.phone}
            hint="We call from a Raipur number."
          />
          <Input
            id="contact-email"
            label="Email (optional)"
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
          <Select
            id="contact-service"
            label="What do you need?"
            required
            wrapperClassName="sm:col-span-2"
            options={serviceOptions}
            placeholder="Choose a service"
            value={values.service}
            onChange={set('service')}
            error={errors.service}
          />
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
