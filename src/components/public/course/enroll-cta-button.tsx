'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { RequestModal } from '@/components/enrollment/request-modal';
import type { EnrollmentModalData } from '@/components/enrollment/types';

/**
 * « Demander l'accès — 1 200 DH » (§12.4) — the only CTA on the course page
 * that opens something instead of navigating.
 *
 * `resolveEnrollCta` decides on the server that this visitor is in the buying
 * state and sets `opensRequestModal`; this component is the client edge that
 * the decision points at. Everything the modal needs — price, bank
 * coordinates, upload ceilings — was resolved by the page and travels as plain
 * data, so the modal itself is never rendered (and never downloaded as state)
 * for a visitor who cannot buy.
 *
 * The button carries no state beyond « is the dialog open ». The request, its
 * reference and its receipt all live in the modal, which owns the flow.
 */

export interface EnrollCtaButtonProps {
  /** Already translated and priced, e.g. « Demander l'accès — 1 200 DH ». */
  readonly label: string;
  readonly data: EnrollmentModalData;
  readonly size?: 'md' | 'lg';
  readonly fullWidth?: boolean;
}

export function EnrollCtaButton({
  label,
  data,
  size = 'lg',
  fullWidth = true,
}: EnrollCtaButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size={size}
        fullWidth={fullWidth}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>

      <RequestModal open={open} onOpenChange={setOpen} data={data} />
    </>
  );
}
