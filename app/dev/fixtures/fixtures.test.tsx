import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ControlView } from '@/app/host/[pin]/control/control-views';
import { DisplayView } from '@/app/host/[pin]/display/display-views';
import { PlayerView } from '@/app/play/[pin]/player-views';
import { fixtures } from '@/lib/dev-fixtures';

describe('fixture × surface snapshots', () => {
  for (const f of fixtures) {
    const pin = f.pin ?? f.state.pin;

    if (f.category === 'shared' || f.category === 'display') {
      it(`display · ${f.id}`, () => {
        const { container } = render(<DisplayView state={f.state} pin={pin} />);
        expect(container).toMatchSnapshot();
      });
    }
    if (f.category === 'shared' || f.category === 'control') {
      it(`control · ${f.id}`, () => {
        const { container } = render(<ControlView state={f.state} pin={pin} />);
        expect(container).toMatchSnapshot();
      });
    }
    if (f.category === 'shared' || f.category === 'player') {
      it(`player · ${f.id}`, () => {
        const { container } = render(
          <PlayerView state={f.state} personal={f.personal ?? null} nickname="QA" pin={pin} />,
        );
        expect(container).toMatchSnapshot();
      });
    }
  }
});
