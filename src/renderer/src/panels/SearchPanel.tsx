// Search in the left panel (8.7 w2c): the same search as the window (components/SearchView.tsx), in the panel's narrow
// shape. The window answers from the model while it is open, so the panel behind it stays quiet until it closes.

import { SearchView } from '../components/SearchView';
import { useModal } from '../state/modals';

export function SearchPanel() {
  const modal = useModal();
  return (
    <div className="panel search">
      <SearchView host="panel" active={modal?.kind !== 'search'} autoFocus={false} onOpenResult={() => {}} />
    </div>
  );
}
