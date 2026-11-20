// SPDX-License-Identifier: AGPL-3.0-or-later
// A small "Supporter" mark (About, the side bar's foot, the account page) when the account or the licence in force has
// the `supporter` entitlement. A thank-you only: nothing anywhere depends on it.
import { isSupporter } from '../../../../shared/account';
import { Icon } from '../Icon';
import { openAccountPage, useAccount } from './accountState';
import '../../styles/account.css';

export function SupporterBadge({ link = false }: { link?: boolean }) {
  const body = (
    <>
      <Icon name="heart" size={11} />
      Supporter
    </>
  );
  if (!link) return <span className="acct-badge" title="Thank you for supporting Ironleaf">{body}</span>;
  return (
    <button type="button" className="acct-badge" title="Thank you for supporting Ironleaf. Account and plan" onClick={openAccountPage}>
      {body}
    </button>
  );
}

/** The badge only when the account is a Supporter (nothing otherwise). */
export function SupporterMark({ link = false }: { link?: boolean }) {
  const view = useAccount();
  return isSupporter(view) ? <SupporterBadge link={link} /> : null;
}
