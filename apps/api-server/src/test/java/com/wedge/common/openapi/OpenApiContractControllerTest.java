package com.wedge.common.openapi;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OpenApiContractControllerTest {
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpenApiContractController()).build();

    @Test
    void servesCanonicalOpenApiContractForSwaggerUi() throws Exception {
        mockMvc.perform(get("/openapi/wedge_openapi.yaml"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andExpect(content().string(containsString("openapi: 3.0.3")))
                .andExpect(content().string(containsString("signupBasicMvp:")));
    }
}
