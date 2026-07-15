import { useWorkspace } from '../state/workspaceStore';

export function VaultPicker() {
  const { pickVault, loading, error } = useWorkspace();
  return (
    <div className="vault-picker">
      <div className="vault-picker__card">
        <div className="vault-picker__orb">
          <span className="msi">deployed_code</span>
        </div>
        <h1>memoview</h1>
        <p>Open a folder to use as your vault.</p>
        <button type="button" disabled={loading} onClick={() => pickVault()}>
          {loading ? 'Opening…' : 'Open Vault'}
        </button>
        {error ? <p className="vault-picker__error">{error}</p> : null}
      </div>
    </div>
  );
}
