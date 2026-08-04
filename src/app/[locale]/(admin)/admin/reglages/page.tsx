import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  SETTING_GROUPS,
  listFeatureFlags,
  readAllSettings,
  type FeatureFlagState,
  type SettingGroupState,
} from '@/server/services/settings-admin';

import { SettingsForm } from './settings-form';
import type { FeatureFlagView, SettingGroupView } from './settings-view';

/**
 * `/admin/reglages` — the settings screen (§17.12).
 *
 * A Server Component that owns the guard, the catalogue and the translations,
 * and hands the form finished strings. The client never imports
 * `services/settings-admin` — that module reaches Prisma — so the labels, the
 * hints and the per-group edit right are resolved here and travel as data.
 *
 * ## What is on this page, and what is deliberately not
 * §17.12 lists fourteen tabs. The ones here are the ones whose keys have a
 * **reader** in the codebase today: the centre's identity and contact block
 * (public chrome, e-mail headers), its bank coordinates (the §9.2 payment
 * modal), the legal mentions printed on invoices, and the request expiry the
 * enrolment service reads per transaction. SMTP, storage, video and AI are
 * configured through the environment at this milestone, and a form that wrote
 * settings nothing reads would be a lie with a save button (rule 8).
 */

type LocaleParams = { locale: string };

/** Feature-flag key → sub-key of `admin.settings.features`. */
const FLAG_LABEL_KEY: Readonly<Record<string, string>> = {
  'feature.reviews': 'features.reviews',
  'feature.aiAssistant': 'features.ai',
  'feature.paths': 'features.paths',
  'feature.blog': 'features.blog',
  'feature.liveSessions': 'features.liveSessions',
  'feature.flashcards': 'features.flashcards',
  'feature.leaderboard': 'features.leaderboard',
  'feature.referral': 'features.referral',
};

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const t = await getTranslations('admin.settings');

  const [settingsResult, flagsResult] = await Promise.all([
    readAllSettings(user),
    listFeatureFlags(user),
  ]);

  // `requirePageAdmin` has already run, so a refusal here means the capability
  // matrix says this administrator may not configure the centre at all.
  if (!settingsResult.ok) notFound();

  const states = new Map<string, SettingGroupState>(
    settingsResult.data.map((state) => [state.id, state]),
  );

  const groups: readonly SettingGroupView[] = SETTING_GROUPS.map((spec): SettingGroupView => {
    const state = states.get(spec.id);
    const values = state?.values ?? {};

    return {
      id: spec.id,
      title: t(spec.titleKey),
      intro: spec.introKey === undefined ? null : t(spec.introKey),
      editable: state?.editable ?? false,
      // §23: the seeded RIB is a marker, not an account. While it is still in
      // place every enrolment shows it to a student, so the warning is a full
      // alert at the top of the group rather than a hint under a field.
      placeholderWarning:
        spec.id === 'bank' && state?.hasPlaceholder === true
          ? t('bank.placeholderRibWarning')
          : null,
      fields: spec.fields.map((field) => ({
        key: field.key,
        label: field.labelKey === null ? (field.literalLabel ?? field.key) : t(field.labelKey),
        hint: field.hintKey === undefined ? null : t(field.hintKey),
        kind: field.kind,
        value: values[field.key] ?? '',
        ltr: field.ltr === true,
        required: field.required === true,
        maxLength: field.maxLength ?? null,
        min: field.min ?? null,
        max: field.max ?? null,
      })),
    };
  });

  const flagRows: readonly FeatureFlagState[] = flagsResult.ok ? flagsResult.data : [];
  const flags: readonly FeatureFlagView[] = flagRows.map((flag) => {
    const labelKey = FLAG_LABEL_KEY[flag.key];
    return {
      key: flag.key,
      // A flag added by a later milestone with no label yet shows its own key
      // rather than a translated guess at what it does.
      label: labelKey === undefined ? flag.key : t(labelKey),
      note: flag.note,
      isEnabled: flag.isEnabled,
    };
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <SettingsForm groups={groups} flags={flags} featuresTitle={t('tabs.features')} />
    </div>
  );
}
