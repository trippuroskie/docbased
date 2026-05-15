"use client"

import { MoreHorizontal, Download, Pencil, FileText, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

export function DocumentViewer() {
  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Toolbar */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors">IT</span>
          <span>›</span>
          <span className="hover:text-foreground cursor-pointer transition-colors">Networking</span>
          <span>›</span>
          <span className="text-foreground">Site-to-site VPN runbook</span>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
            <Download className="size-3.5" />
            Download original
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      {/* Document Content */}
      <ScrollArea className="flex-1">
        <article className="max-w-3xl mx-auto px-8 py-8">
          {/* Title */}
          <h1 className="text-2xl font-semibold tracking-tight mb-4">
            Site-to-site VPN runbook
          </h1>

          {/* Metadata Pills */}
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <Badge variant="secondary" className="text-xs font-normal">
              Last edited 3 days ago by Tripp
            </Badge>
            <Badge variant="secondary" className="text-xs font-normal">
              Tagged: networking, vpn, fortinet
            </Badge>
            <Badge 
              variant="outline" 
              className="text-xs font-normal border-amber-500/30 text-amber-500 bg-amber-500/10"
            >
              <AlertTriangle className="size-3 mr-1" />
              Last verified 14 months ago
            </Badge>
          </div>

          {/* Document Body */}
          <div className="prose prose-invert prose-sm max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              This runbook covers the end-to-end process for establishing and maintaining site-to-site VPN tunnels 
              between our primary datacenter and branch offices using FortiGate firewalls.
            </p>

            <h2 className="text-lg font-semibold mt-8 mb-4 text-foreground">Prerequisites</h2>
            <ul className="space-y-2 text-muted-foreground list-disc list-inside">
              <li>FortiGate admin credentials with VPN management permissions</li>
              <li>Network diagram showing WAN IPs and internal subnets for both sites</li>
              <li>Pre-shared key from the secure vault (rotate every 90 days)</li>
              <li>Firewall change request approved in ServiceNow</li>
            </ul>

            <h2 className="text-lg font-semibold mt-8 mb-4 text-foreground">Step-by-step configuration</h2>
            <ol className="space-y-3 text-muted-foreground list-decimal list-inside">
              <li>
                Log into the FortiGate web interface and navigate to <strong className="text-foreground">VPN → IPsec Tunnels</strong>. 
                Click <strong className="text-foreground">Create New</strong> and select <strong className="text-foreground">Custom</strong> template.
              </li>
              <li>
                Configure Phase 1 settings. Set the remote gateway IP, interface, and authentication method. 
                Use the following CLI if preferred:
              </li>
            </ol>

            {/* Inline Code Example */}
            <p className="text-muted-foreground mt-4 mb-2">
              The base command structure for Phase 1 configuration:
            </p>
            <code className="bg-secondary/70 text-primary px-1.5 py-0.5 rounded text-xs font-mono">
              config vpn ipsec phase1-interface
            </code>

            {/* Code Block */}
            <div className="mt-6 mb-6 rounded-md bg-secondary/50 border border-border overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-secondary/30 text-xs text-muted-foreground font-mono">
                fortinet-cli
              </div>
              <pre className="p-4 text-xs font-mono text-foreground overflow-x-auto leading-relaxed">
{`config vpn ipsec phase1-interface
  edit "branch-office-01"
    set interface "wan1"
    set ike-version 2
    set peertype any
    set net-device disable
    set proposal aes256-sha256
    set remote-gw 203.0.113.50
    set psksecret ENC [encrypted-key-ref]
  next
end`}
              </pre>
            </div>

            <ol className="space-y-3 text-muted-foreground list-decimal list-inside" start={3}>
              <li>
                Configure Phase 2 selectors to define which traffic should traverse the tunnel. 
                Specify the local and remote subnets (e.g., <code className="bg-secondary/70 text-primary px-1 py-0.5 rounded text-xs font-mono">10.1.0.0/16</code> ↔ <code className="bg-secondary/70 text-primary px-1 py-0.5 rounded text-xs font-mono">10.2.0.0/16</code>).
              </li>
            </ol>

            {/* Callout/Blockquote */}
            <blockquote className="mt-6 border-l-2 border-primary/50 pl-4 py-2 bg-primary/5 rounded-r-md">
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Rotate the pre-shared key every 90 days. Coordinate with the remote site admin 
                and update both endpoints simultaneously during a maintenance window.
              </p>
            </blockquote>

            <h2 className="text-lg font-semibold mt-8 mb-4 text-foreground">Verification</h2>
            <p className="text-muted-foreground leading-relaxed">
              After configuration, verify tunnel status using <code className="bg-secondary/70 text-primary px-1 py-0.5 rounded text-xs font-mono">get vpn ipsec tunnel summary</code>. 
              Both Phase 1 and Phase 2 should show status <strong className="text-emerald-400">UP</strong>. 
              Test connectivity by pinging hosts across the tunnel from both sites.
            </p>
          </div>

          {/* Backlinks Section */}
          <div className="mt-12 pt-8 border-t border-border">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Backlinks</h3>
            <div className="grid grid-cols-2 gap-3">
              <a 
                href="#" 
                className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/50 transition-colors group"
              >
                <FileText className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    Site network diagram
                  </p>
                  <p className="text-xs text-muted-foreground truncate">IT › Networking</p>
                </div>
              </a>
              <a 
                href="#" 
                className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/50 transition-colors group"
              >
                <FileText className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    Vendor escalation contacts
                  </p>
                  <p className="text-xs text-muted-foreground truncate">IT › Vendors</p>
                </div>
              </a>
            </div>
          </div>
        </article>
      </ScrollArea>
    </div>
  )
}
