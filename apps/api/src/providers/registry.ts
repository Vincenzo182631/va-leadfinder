import type { Deps } from '../types';
import { licensedApiProvider } from './licensed-api';
import { manualProvider } from './manual';
import { syntheticDemoProvider } from './synthetic-demo';
import type { OpportunityProvider, RawRecord, SourceProviderRow } from './types';

export function providerFor(row: SourceProviderRow, deps: Deps, supplied: RawRecord[] = []): OpportunityProvider {
  switch (row.provider_kind) {
    case 'synthetic_demo':
      return syntheticDemoProvider(deps.now);
    case 'manual':
      return manualProvider(row.api_identifier, supplied);
    case 'licensed_api':
      return licensedApiProvider(deps.config);
  }
}
