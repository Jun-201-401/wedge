package com.wedge.report.application;

import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.run.api.dto.RunResponse;

public interface ReportPdfRenderer {
    byte[] render(ReportDetailResponse report, RunResponse run);
}
