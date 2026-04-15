type FeishuIdentityLike = {
  open_id?: string;
  user_id?: string;
  union_id?: string;
  enterprise_email?: string;
  email?: string;
  mobile?: string;
};

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveFeishuStablePersonKey(identity: FeishuIdentityLike): string | undefined {
  return (
    normalizeString(identity.union_id) ??
    normalizeString(identity.user_id) ??
    normalizeString(identity.enterprise_email)?.toLowerCase() ??
    normalizeString(identity.email)?.toLowerCase() ??
    normalizeString(identity.mobile)
  );
}

export function resolveFeishuPreferredSendTarget(identity: FeishuIdentityLike): string | undefined {
  const userId = normalizeString(identity.user_id);
  if (userId) {
    return `user:${userId}`;
  }
  const openId = normalizeString(identity.open_id);
  if (openId) {
    return `user:${openId}`;
  }
  return undefined;
}
