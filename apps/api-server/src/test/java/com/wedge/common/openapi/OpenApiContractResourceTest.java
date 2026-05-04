package com.wedge.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class OpenApiContractResourceTest {
    @Test
    void canonicalContractIsPackagedForSwaggerUi() throws IOException {
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream("static/openapi/wedge_openapi.yaml")) {
            assertThat(stream).isNotNull();
            String openApi = new String(stream.readAllBytes(), StandardCharsets.UTF_8);

            assertThat(openApi).contains("openapi: 3.0.3");
            assertThat(openApi).contains("url: http://localhost:8080");
            assertThat(openApi).contains("HumanBearer:");
            assertThat(openApi).contains("signupBasicMvp:");
        }
    }
}
