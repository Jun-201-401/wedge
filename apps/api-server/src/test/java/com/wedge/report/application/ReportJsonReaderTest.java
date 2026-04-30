package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class ReportJsonReaderTest {
    private final ReportJsonReader reportJsonReader = new ReportJsonReader(new ObjectMapper());

    @Test
    void readObjectAcceptsOnlyJsonObject() {
        assertThat(reportJsonReader.readObject("{\"friction_score\":61.0}"))
                .containsEntry("friction_score", 61.0);

        assertThatThrownBy(() -> reportJsonReader.readObject("[{\"stage\":\"CTA\"}]"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Stored report JSON object is invalid.");
    }

    @Test
    void readArrayAcceptsOnlyJsonArray() {
        assertThat(reportJsonReader.readArray("[{\"stage\":\"CTA\"}]")).hasSize(1);

        assertThatThrownBy(() -> reportJsonReader.readArray("{\"stage\":\"CTA\"}"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Stored report JSON array is invalid.");
    }

    @Test
    void readDecisionMapValidatesRequiredItemShape() {
        String decisionMap = """
                [{"stage":"CTA","displayName":"행동 선택","status":"WARNING",
                "issueIds":["issue_001"],"summary":null,"evidenceRefs":["cp_001.obs_001"]}]
                """;

        assertThat(reportJsonReader.readDecisionMap(decisionMap)).singleElement()
                .satisfies(item -> {
                    assertThat(item.stage()).isEqualTo("CTA");
                    assertThat(item.issueIds()).containsExactly("issue_001");
                });

        assertThatThrownBy(() -> reportJsonReader.readDecisionMap("[{\"stage\":\"CTA\",\"status\":\"WARNING\"}]"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Stored decision map item JSON is invalid.");
    }

    @Test
    void readDecisionMapRejectsMalformedJsonAndNonTextRefs() {
        assertThatThrownBy(() -> reportJsonReader.readDecisionMap("["))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Stored report JSON is invalid.");

        assertThatThrownBy(() -> reportJsonReader.readDecisionMap("""
                [{"stage":"CTA","displayName":"행동 선택","status":"WARNING",
                "issueIds":[1],"evidenceRefs":["cp_001.obs_001"]}]
                """))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Stored decision map item JSON is invalid.");
    }

    @Test
    void readFrictionScoreReturnsBigDecimalForNumericValue() {
        BigDecimal score = reportJsonReader.readFrictionScore(reportJsonReader.readObject("{\"friction_score\":61.5}"));

        assertThat(score).isEqualByComparingTo(new BigDecimal("61.5"));
    }
}
