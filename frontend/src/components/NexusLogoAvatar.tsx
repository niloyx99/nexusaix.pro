// Served from frontend/public — copied to dist root by Vite (reliable on Linux deploys).
const userProfile = `${import.meta.env.BASE_URL}user_profile.png`;

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface NexusLogoAvatarProps {
  size?: AvatarSize;
  className?: string;
  rounded?: 'md' | 'lg' | 'xl' | 'full';
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'w-8 h-8',
  sm: 'w-10 h-10',
  md: 'w-11 h-11',
  lg: 'w-14 h-14',
  xl: 'w-20 h-20',
};

const ROUNDED_CLASS = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

export default function NexusLogoAvatar({
  size = 'sm',
  className = '',
  rounded = 'lg',
}: NexusLogoAvatarProps) {
  return (
    <img
      src={userProfile}
      alt="Profile"
      className={`${SIZE_CLASS[size]} shrink-0 ${ROUNDED_CLASS[rounded]} object-cover object-center select-none ${className}`}
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
}
