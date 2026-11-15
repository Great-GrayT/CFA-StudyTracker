import { Badge, type BadgeVariantNames } from '@/components/ui/badge';
import packageInfo from '../../../package.json';

const STAGES: Record<string, { text: string; variant: BadgeVariantNames }> = {
  alpha: { text: 'Alpha', variant: 'destructive' },
  beta: { text: 'Beta', variant: 'secondary' },
  rc: { text: 'Release candidate', variant: 'outline' },
};

export function Footer() {
  // "1.2.0-beta.3" -> displayVersion "1.2.0", stage "beta", stageNumber "3"
  const [displayVersion, pre = ''] = packageInfo.version.split('-');
  const [stageKey, stageNumber] = pre.split('.');
  const stage = STAGES[stageKey];

  return (
    <footer className="text-muted-foreground flex items-center gap-2 text-sm">
      <span>Version {displayVersion}</span>
      {stage && (
        <Badge variant={stage.variant} className="text-xs font-normal">
          {stage.text} {stageNumber}
        </Badge>
      )}
    </footer>
  );
}
