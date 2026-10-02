FROM python:3.11-slim
WORKDIR /opt/gnosi-connector
COPY pyproject.toml ./
COPY gnosi_connector ./gnosi_connector
RUN pip install --no-cache-dir . && useradd --uid 10001 --create-home connector
USER 10001
EXPOSE 8787
ENTRYPOINT ["gnosi-connector"]
CMD ["--transport", "http", "--host", "0.0.0.0"]
