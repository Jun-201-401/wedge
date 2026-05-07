package com.wedge.report.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportShareResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportShare;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.report.infrastructure.ReportShareMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReportShareService {
    private static final String VIEW_ACCESS = "VIEW";

    private final ReportMapper reportMapper;
    private final ReportShareMapper reportShareMapper;
    private final RunService runService;
    private final ReportAccessGuard reportAccessGuard;
    private final ReportDetailQueryService reportDetailQueryService;
    private final ReportProperties reportProperties;
    private final ReportShareTokenGenerator tokenGenerator;
    private final Clock clock;

    @Transactional(readOnly = true)
    public List<ReportShareResponse> listReportShares(UUID reportId, UUID userId) {
        ensureReportAccessible(reportId, userId);
        return reportShareMapper.findByReportId(reportId).stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public ReportShareResponse createReportShare(UUID reportId, UUID userId) {
        ensureReportAccessible(reportId, userId);
        OffsetDateTime now = now();
        ReportShare share = new ReportShare();
        share.setId(UUID.randomUUID());
        share.setReportId(reportId);
        share.setShareToken(tokenGenerator.generate());
        share.setAccessLevel(VIEW_ACCESS);
        share.setExpiresAt(now.plusMinutes(reportProperties.getShareDefaultExpirationMinutes()));
        share.setCreatedBy(userId);
        share.setCreatedAt(now);
        reportShareMapper.insert(share);
        return toResponse(share);
    }

    @Transactional
    public void revokeReportShare(UUID reportId, UUID shareId, UUID userId) {
        ensureReportAccessible(reportId, userId);
        int updated = reportShareMapper.revoke(shareId, reportId, now());
        if (updated == 0) {
            throw new BusinessException(ErrorCode.REPORT_NOT_FOUND, "Report share was not found.");
        }
    }

    @Transactional(readOnly = true)
    public ReportDetailResponse getSharedReport(String shareToken) {
        ReportShare share = reportShareMapper.findActiveByToken(shareToken, now())
                .orElseThrow(() -> new BusinessException(ErrorCode.REPORT_NOT_FOUND, "Report share was not found or expired."));
        return reportDetailQueryService.getSharedReportDetail(share.getReportId());
    }

    private void ensureReportAccessible(UUID reportId, UUID userId) {
        Report report = reportMapper.findById(reportId)
                .orElseThrow(() -> new BusinessException(ErrorCode.REPORT_NOT_FOUND));
        RunResponse run = runService.getRun(report.getRunId());
        reportAccessGuard.ensureProjectAccessible(run.projectId(), userId);
    }

    private ReportShareResponse toResponse(ReportShare share) {
        return ReportShareResponse.from(share, reportProperties.shareUrl(share.getShareToken()));
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }
}
