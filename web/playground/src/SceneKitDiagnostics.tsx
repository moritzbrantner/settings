// Developer diagnostics for the preview's scene kit (issue #25): which pinned asset-tooling
// release tars were installed, whether their manifests still match the export refs recorded at
// build time, and for every representative asset which bundle variant the 3d-lab renderer drew or
// why it fell back to a proxy. This is presentation only; none of it is settings metadata.
import type { SceneKit } from './sceneKit';

const short = (hash: string | null) => (hash ? hash.slice(0, 12) : '—');

export function SceneKitDiagnostics({ kit }: { kit: SceneKit | null }) {
  return (
    <details data-testid="scene-kit-diagnostics" className="rounded-md border border-border p-2 text-xs">
      <summary className="cursor-pointer font-medium">Developer diagnostics: scene kit provenance</summary>
      {kit === null && <p className="mt-2">Loading the scene kit…</p>}
      {kit?.status === 'unavailable' && (
        <p role="status" className="mt-2">
          {kit.reason} The preview draws proxies instead.
        </p>
      )}
      {kit && kit.bundles.length > 0 && (
        <table className="mt-2 w-full text-left" data-testid="scene-kit-bundles">
          <caption className="text-left font-medium">Pinned asset-tooling releases</caption>
          <thead>
            <tr>
              <th scope="col">Release</th>
              <th scope="col">Tar SHA-256</th>
              <th scope="col">Export ref</th>
              <th scope="col">Manifest</th>
            </tr>
          </thead>
          <tbody>
            {kit.bundles.map((bundle) => (
              <tr key={bundle.id} data-bundle={bundle.id}>
                <td>
                  {bundle.release}/{bundle.asset}
                </td>
                <td>
                  <code title={bundle.tarSha256}>{bundle.tarSha256}</code>
                </td>
                <td>
                  <code title={bundle.exportRef.sha256}>{short(bundle.exportRef.sha256)}</code>
                </td>
                <td>{bundle.manifestVerified ? 'verified' : 'mismatch'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kit && kit.members.length > 0 && (
        <table className="mt-2 w-full text-left" data-testid="scene-kit-members">
          <caption className="text-left font-medium">Representative assets</caption>
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Drawn variant</th>
              <th scope="col">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {kit.members.map((member) => (
              <tr key={member.key} data-member={member.key} data-variant={member.variant ?? 'proxy'}>
                <td>{member.key}</td>
                <td>{member.variant ?? 'proxy (fallback)'}</td>
                <td>
                  <ul>
                    {member.attempts.map((attempt) => (
                      <li key={attempt.variant}>
                        {`${attempt.variant} ${short(attempt.sha256)}`}
                        {attempt.triangles !== null && ` · ${attempt.triangles} triangles`}
                        {attempt.error ? ` · not drawn: ${attempt.error}` : ' · drawn'}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
