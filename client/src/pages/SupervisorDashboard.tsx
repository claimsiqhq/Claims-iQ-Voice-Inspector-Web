import Layout from "@/components/Layout";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Users, Zap, Target, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DashboardMetrics {
  totalClaims: number;
  activeSessions: number;
  avgInspectionTime: number;
  totalEstimateValue: number;
  autoScopeItemsCreated?: number;
  avgAutoScopePerDamage?: number;
  catalogMatchRate?: number;
  avgCompletenessScore?: number;
}

interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  activeClaims: number;
}

interface ActiveSession {
  id: number;
  claimNumber: string;
  claimId: number;
  adjusterName: string;
  currentPhase: number;
  status: string;
  startedAt: string;
  completenessScore?: number;
}

export default function SupervisorDashboard() {
  const { data: metrics } = useQuery<DashboardMetrics>({
    queryKey: ["/api/admin/dashboard"],
  });

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: activeSessions = [] } = useQuery<ActiveSession[]>({
    queryKey: ["/api/admin/active-sessions"],
  });

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Team Dashboard</h1>
          <p className="text-muted-foreground mt-2">Manage claims and monitor team performance</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <p className="text-sm font-medium text-gray-600">Total Claims</p>
            <p className="text-3xl font-bold mt-2">{metrics?.totalClaims || 0}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <p className="text-sm font-medium text-gray-600">Active Inspections</p>
            <p className="text-3xl font-bold mt-2 text-green-600">{metrics?.activeSessions || 0}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <p className="text-sm font-medium text-gray-600">Avg Inspection Time</p>
            <p className="text-3xl font-bold mt-2">{Math.round(metrics?.avgInspectionTime || 0)} min</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <p className="text-sm font-medium text-gray-600">Total Estimates</p>
            <p className="text-3xl font-bold mt-2">${(metrics?.totalEstimateValue || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-lg shadow border border-green-200">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              <p className="text-sm font-medium text-gray-600">Auto-Scope Items</p>
            </div>
            <p className="text-3xl font-bold mt-2 text-green-600">{metrics?.autoScopeItemsCreated || 0}</p>
            <p className="text-xs text-gray-500 mt-1">
              Avg {(metrics?.avgAutoScopePerDamage || 0).toFixed(1)} items/damage
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border border-purple-200">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              <p className="text-sm font-medium text-gray-600">Catalog Match Rate</p>
            </div>
            <p className="text-3xl font-bold mt-2 text-purple-600">
              {Math.round(metrics?.catalogMatchRate || 0)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Items priced from catalog</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border border-blue-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
              <p className="text-sm font-medium text-gray-600">Avg Completeness</p>
            </div>
            <p className="text-3xl font-bold mt-2 text-blue-600">
              {Math.round(metrics?.avgCompletenessScore || 0)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Phase validation score</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h2 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5" /> Team Members
          </h2>
          {teamMembers.length === 0 ? (
            <p className="text-muted-foreground">No team members assigned yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Active Claims</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMembers.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.fullName}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{member.role}</Badge>
                    </TableCell>
                    <TableCell className="font-bold">{member.activeClaims}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h2 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" /> Active Inspections
          </h2>
          {activeSessions.length === 0 ? (
            <p className="text-muted-foreground">No active inspections right now</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim #</TableHead>
                  <TableHead>Adjuster</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Completeness</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-mono font-bold">{session.claimNumber}</TableCell>
                    <TableCell>{session.adjusterName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-center">{session.currentPhase}</span>
                        <span className="text-[10px] text-muted-foreground">/8</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              (session.completenessScore ?? 0) >= 80 ? "bg-green-500" :
                              (session.completenessScore ?? 0) >= 50 ? "bg-yellow-500" :
                              "bg-red-500"
                            )}
                            style={{ width: `${session.completenessScore ?? 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{session.completenessScore ?? 0}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{session.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(session.startedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </Layout>
  );
}
