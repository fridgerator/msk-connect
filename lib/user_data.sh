sudo yum install -y java-1.8.0-openjdk-devel wget && \
  cd /home/ssm-user && \
  wget https://archive.apache.org/dist/kafka/3.3.1/kafka_2.13-3.3.1.tgz && \
  mkdir kafka && \
  tar -xvzf kafka_2.13-3.3.1.tgz -C ./kafka --strip 1 && \
  echo 'export PATH="$PATH:/home/ssm-user/kafka/bin"' >> /home/ssm-user/.bashrc && \
  echo "security.protocol=SSL" >> /home/ssm-user/client.properties
